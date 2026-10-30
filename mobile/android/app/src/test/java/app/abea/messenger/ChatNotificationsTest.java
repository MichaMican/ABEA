package app.abea.messenger;

import static org.junit.Assert.*;
import static org.robolectric.Shadows.shadowOf;

import android.Manifest;
import android.app.Application;
import android.app.Notification;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Bundle;
import androidx.core.app.NotificationCompat;
import androidx.core.app.RemoteInput;
import com.google.firebase.messaging.RemoteMessage;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = {28, 35})
public class ChatNotificationsTest {
    private Application context;
    private static final String ROOM = "!chat:example.org";
    private static final String USER = "@me:example.org";

    @Before
    public void setUp() {
        context = RuntimeEnvironment.getApplication();
        shadowOf(context).grantPermissions(Manifest.permission.POST_NOTIFICATIONS);
        ChatNotifications.configure(context, USER, true);
    }

    @After
    public void tearDown() {
        ChatNotifications.configure(context, null, false);
    }

    private void show(String event, String body, boolean direct, long timestamp) {
        ChatNotifications.show(context, ROOM, event, "Alice", "@alice:example.org", "Alice", body, direct, timestamp);
    }

    @Test
    public void conversationHasSenderHistoryAndActions() {
        show("$one", "First", true, 1);
        show("$two", "Second", true, 2);
        Notification notification = ChatNotifications.find(context, ROOM);
        NotificationCompat.MessagingStyle style = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(notification);
        assertNotNull(style);
        assertFalse(style.isGroupConversation());
        assertEquals(2, style.getMessages().size());
        assertEquals("Alice", style.getMessages().get(0).getPerson().getName());
        assertEquals("Second", style.getMessages().get(1).getText().toString());
        assertEquals(Notification.CATEGORY_MESSAGE, notification.category);
        assertEquals("chat:" + ROOM, notification.getShortcutId());
        assertEquals(2, notification.actions.length);
        assertEquals("Mark as read", notification.actions[0].title.toString());
        assertEquals("Reply", notification.actions[1].title.toString());
        assertEquals(ChatNotifications.REPLY_KEY, notification.actions[1].getRemoteInputs()[0].getResultKey());
        assertEquals(0, shadowOf(notification.actions[1].actionIntent).getFlags() & PendingIntent.FLAG_IMMUTABLE);
        assertNotEquals(0, shadowOf(notification.actions[0].actionIntent).getFlags() & PendingIntent.FLAG_IMMUTABLE);
        assertEquals(0, notification.flags & Notification.FLAG_AUTO_CANCEL);
    }

    @Test
    public void groupConversationHasItsOwnTitle() {
        show("$one", "Hello", false, 1);
        NotificationCompat.MessagingStyle style = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(
            ChatNotifications.find(context, ROOM));
        assertTrue(style.isGroupConversation());
        assertEquals("Alice", style.getConversationTitle().toString());
    }

    @Test
    public void decryptedMessageReplacesPushWithoutDuplicatingOrDroppingNewerMessages() {
        show("$one", "New encrypted message", true, 1);
        show("$two", "Newer", true, 3);
        show("$one", "Decrypted", true, 2);
        Notification notification = ChatNotifications.find(context, ROOM);
        NotificationCompat.MessagingStyle style = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(notification);
        assertEquals(2, style.getMessages().size());
        assertEquals("Decrypted", style.getMessages().get(0).getText().toString());
        assertEquals("$two", notification.extras.getString(ChatNotifications.EVENT_ID));
    }

    @Test
    public void clearingReadEventDoesNotDismissANewerMessageOrAnotherRoom() {
        show("$one", "Old", true, 1);
        show("$two", "New", true, 2);
        ChatNotifications.show(context, "!other:example.org", "$other", "Other", "@bob:example.org", "Bob", "Hi", true, 3);
        ChatNotifications.clear(context, ROOM, "$one");
        assertNotNull(ChatNotifications.find(context, ROOM));
        ChatNotifications.clear(context, ROOM, "$two");
        assertNull(ChatNotifications.find(context, ROOM));
        assertNotNull(ChatNotifications.find(context, "!other:example.org"));
    }

    @Test
    public void hashCollidingRoomIdsDoNotReplaceEachOther() {
        assertEquals("Aa".hashCode(), "BB".hashCode());
        ChatNotifications.show(context, "Aa", "$a", "One", "alice", "Alice", "One", true, 1);
        ChatNotifications.show(context, "BB", "$b", "Two", "bob", "Bob", "Two", true, 2);
        ChatNotifications.clear(context, "Aa", "$a");
        assertNotNull(ChatNotifications.find(context, "BB"));
    }

    @Test
    public void badgeOnlyZeroUnreadPushClearsNotificationsWithoutRoomId() {
        show("$one", "Hello", true, 1);
        AbeaMessagingService service = Robolectric.buildService(AbeaMessagingService.class).create().get();
        Map<String, String> data = new HashMap<>();
        data.put("unread", "0");
        service.onMessageReceived(new RemoteMessage.Builder("test").setData(data).build());
        assertTrue(ChatNotifications.delivered(context).isEmpty());
    }

    @Test
    public void fcmV1FlattenedContentUsesActualMessageText() {
        AbeaMessagingService service = Robolectric.buildService(AbeaMessagingService.class).create().get();
        Map<String, String> data = new HashMap<>();
        data.put("room_id", ROOM);
        data.put("event_id", "$one");
        data.put("content_msgtype", "m.text");
        data.put("content_body", "Hello from FCM v1");
        data.put("sender", "@alice:example.org");
        service.onMessageReceived(new RemoteMessage.Builder("test").setData(data).build());
        NotificationCompat.MessagingStyle style = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(
            ChatNotifications.find(context, ROOM));
        assertEquals("Hello from FCM v1", style.getMessages().get(0).getText().toString());
    }

    @Test
    public void inlineReplyQueuesTheTextAndAccountUntilMatrixAcknowledgesIt() throws Exception {
        show("$one", "Hello", true, 1);
        Notification notification = ChatNotifications.find(context, ROOM);
        PendingIntent pending = notification.actions[1].actionIntent;
        Intent intent = new Intent(shadowOf(pending).getSavedIntent());
        Bundle text = new Bundle();
        text.putCharSequence(ChatNotifications.REPLY_KEY, "Hello back!");
        RemoteInput.addResultsToIntent(new RemoteInput[] {
            new RemoteInput.Builder(ChatNotifications.REPLY_KEY).setLabel("Reply").build()
        }, intent, text);
        new NotificationActionReceiver().onReceive(context, intent);
        assertEquals(1, ChatNotifications.pending(context).length());
        JSONObject action = ChatNotifications.pending(context).getJSONObject(0);
        assertEquals("reply", action.getString("type"));
        assertEquals("Hello back!", action.getString("reply"));
        assertEquals(USER, action.getString("userId"));
        assertNotNull(ChatNotifications.find(context, ROOM));
        ChatNotifications.complete(context, action.getString("id"));
        assertEquals(0, ChatNotifications.pending(context).length());
    }

    @Test
    public void markAsReadQueuesWithoutDismissingBeforeServerConfirmation() throws Exception {
        show("$one", "Hello", true, 1);
        Intent intent = shadowOf(ChatNotifications.find(context, ROOM).actions[0].actionIntent).getSavedIntent();
        new NotificationActionReceiver().onReceive(context, intent);
        assertEquals("read", ChatNotifications.pending(context).getJSONObject(0).getString("type"));
        assertNotNull(ChatNotifications.find(context, ROOM));
    }

    @Test
    public void signingOutClearsNotificationsAndPreventsOldActionsReachingAnotherAccount() throws Exception {
        show("$one", "Hello", true, 1);
        Intent intent = shadowOf(ChatNotifications.find(context, ROOM).actions[0].actionIntent).getSavedIntent();
        ChatNotifications.configure(context, "@new:example.org", true);
        new NotificationActionReceiver().onReceive(context, intent);
        assertEquals(0, ChatNotifications.pending(context).length());
        assertTrue(ChatNotifications.delivered(context).isEmpty());
    }

    @Test
    public void disabledNotificationsAreNotShown() {
        ChatNotifications.configure(context, USER, false);
        show("$one", "Hello", true, 1);
        assertTrue(ChatNotifications.delivered(context).isEmpty());
    }
}
