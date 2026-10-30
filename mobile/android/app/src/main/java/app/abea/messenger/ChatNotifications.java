package app.abea.messenger;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.service.notification.StatusBarNotification;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;
import androidx.core.app.RemoteInput;
import androidx.core.content.LocusIdCompat;
import androidx.core.content.pm.ShortcutInfoCompat;
import androidx.core.content.pm.ShortcutManagerCompat;
import androidx.core.graphics.drawable.IconCompat;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class ChatNotifications {
    static final String CHANNEL_ID = "messages";
    static final String ROOM_ID = "abea.roomId";
    static final String EVENT_ID = "abea.eventId";
    static final String USER_ID = "abea.userId";
    static final String REPLY_KEY = "abea.reply";
    static final String READ = "app.abea.messenger.MARK_READ";
    static final String REPLY = "app.abea.messenger.REPLY";
    static final String ACTIONS_CHANGED = "app.abea.messenger.NOTIFICATION_ACTIONS_CHANGED";
    private static final String PREFS = "abea_notifications";
    private static final String TAG = "ABEA.Notifications";

    private ChatNotifications() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static String userId(Context context) {
        return prefs(context).getString("userId", null);
    }

    static synchronized void configure(Context context, String userId, boolean enabled) {
        SharedPreferences storage = prefs(context);
        if (userId == null || !userId.equals(userId(context))) {
            clearAll(context);
            storage.edit().remove("pending").apply();
        }
        storage.edit().putString("userId", userId).putBoolean("enabled", enabled).apply();
        if (!enabled) clearAll(context);
    }

    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Messages", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("New messages in your chats");
        channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        channel.enableVibration(true);
        manager.createNotificationChannel(channel);
    }

    static synchronized void show(
        Context context, String roomId, String eventId, String roomName, String senderId,
        String senderName, String body, boolean direct, long timestamp
    ) {
        String account = userId(context);
        if (account == null || !prefs(context).getBoolean("enabled", true)) return;
        ensureChannel(context);
        Person sender = new Person.Builder().setName(senderName).setKey(senderId).build();
        NotificationCompat.MessagingStyle style = new NotificationCompat.MessagingStyle(
            new Person.Builder().setName("You").setKey(account).build()
        ).setGroupConversation(!direct);
        if (!direct) style.setConversationTitle(roomName);

        Notification previous = find(context, roomId);
        List<NotificationCompat.MessagingStyle.Message> messages = new ArrayList<>();
        if (previous != null) {
            NotificationCompat.MessagingStyle old = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(previous);
            if (old != null) messages.addAll(old.getMessages());
        }
        // A decrypted /sync event replaces the encrypted push placeholder, rather than duplicating it.
        boolean replacing = messages.removeIf(message -> eventId.equals(message.getExtras().getString(EVENT_ID)));
        NotificationCompat.MessagingStyle.Message message = new NotificationCompat.MessagingStyle.Message(body, timestamp, sender);
        message.getExtras().putString(EVENT_ID, eventId);
        messages.add(message);
        messages.sort((left, right) -> Long.compare(left.getTimestamp(), right.getTimestamp()));
        for (int i = Math.max(0, messages.size() - 25); i < messages.size(); i++) style.addMessage(messages.get(i));

        String latestEventId = messages.get(messages.size() - 1).getExtras().getString(EVENT_ID);
        Bundle extras = new Bundle();
        extras.putString(ROOM_ID, roomId);
        extras.putString(EVENT_ID, latestEventId);
        extras.putString(USER_ID, account);

        Intent open = openIntent(context, roomId);
        String shortcutId = "chat:" + roomId;
        ShortcutInfoCompat shortcut = new ShortcutInfoCompat.Builder(context, shortcutId)
            .setShortLabel(roomName)
            .setLongLived(true)
            .setPerson(sender)
            .setLocusId(new LocusIdCompat(shortcutId))
            .setIcon(IconCompat.createWithResource(context, R.drawable.ic_stat_abea))
            .setIntent(open)
            .build();
        ShortcutManagerCompat.pushDynamicShortcut(context, shortcut);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_abea)
            .setColor(0xFF6A6DFF)
            .setStyle(style)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setShortcutId(shortcutId)
            .setLocusId(new LocusIdCompat(shortcutId))
            .setOnlyAlertOnce(replacing)
            .setAutoCancel(false)
            .setContentIntent(PendingIntent.getActivity(
                context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            ))
            .addExtras(extras)
            .addAction(new NotificationCompat.Action.Builder(
                R.drawable.ic_stat_abea, "Mark as read", actionIntent(context, READ, roomId, latestEventId, account, false)
            ).setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ).setAuthenticationRequired(true).build())
            .addAction(new NotificationCompat.Action.Builder(
                R.drawable.ic_stat_abea, "Reply", actionIntent(context, REPLY, roomId, latestEventId, account, true)
            ).addRemoteInput(new RemoteInput.Builder(REPLY_KEY).setLabel("Reply").build())
                .setAllowGeneratedReplies(true)
                .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
                .setAuthenticationRequired(true)
                .setShowsUserInterface(false)
                .build());
        post(context, roomId, builder.build());
    }

    static Intent openIntent(Context context, String roomId) {
        return new Intent(Intent.ACTION_VIEW, Uri.parse("abea://room/" + Uri.encode(roomId)), context, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    }

    private static PendingIntent actionIntent(
        Context context, String action, String roomId, String eventId, String userId, boolean mutable
    ) {
        Intent intent = new Intent(context, NotificationActionReceiver.class)
            .setAction(action)
            .setData(new Uri.Builder().scheme("abea-action").authority("notification")
                .appendPath(action).appendPath(roomId).appendPath(eventId).build())
            .putExtra(ROOM_ID, roomId)
            .putExtra(EVENT_ID, eventId)
            .putExtra(USER_ID, userId);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        flags |= mutable && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            ? PendingIntent.FLAG_MUTABLE : mutable ? 0 : PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(context, 0, intent, flags);
    }

    static List<StatusBarNotification> delivered(Context context) {
        List<StatusBarNotification> notifications = new ArrayList<>();
        for (StatusBarNotification notification : context.getSystemService(NotificationManager.class).getActiveNotifications()) {
            if (notification.getNotification().extras.containsKey(ROOM_ID)) notifications.add(notification);
        }
        return notifications;
    }

    static Notification find(Context context, String roomId) {
        for (StatusBarNotification notification : delivered(context)) {
            if (roomId.equals(notification.getNotification().extras.getString(ROOM_ID))) return notification.getNotification();
        }
        return null;
    }

    static synchronized void clear(Context context, String roomId, String eventId) {
        Notification notification = find(context, roomId);
        // A newer message may have arrived while JS was checking the old notification's receipt.
        if (notification == null || (eventId != null && !eventId.equals(notification.extras.getString(EVENT_ID)))) return;
        NotificationManagerCompat.from(context).cancel(roomId, roomId.hashCode() & 0x7fffffff);
    }

    static void clearAll(Context context) {
        for (StatusBarNotification notification : context.getSystemService(NotificationManager.class).getActiveNotifications()) {
            Notification value = notification.getNotification();
            if (value.extras.containsKey(ROOM_ID) ||
                (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && CHANNEL_ID.equals(value.getChannelId()))) {
                NotificationManagerCompat.from(context).cancel(notification.getTag(), notification.getId());
            }
        }
    }

    static synchronized JSONArray pending(Context context) throws JSONException {
        return new JSONArray(prefs(context).getString("pending", "[]"));
    }

    static synchronized void enqueue(Context context, JSONObject action) throws JSONException {
        JSONArray pending = pending(context);
        pending.put(action);
        if (!prefs(context).edit().putString("pending", pending.toString()).commit()) {
            throw new IllegalStateException("Could not save notification action");
        }
    }

    static synchronized void complete(Context context, String id) throws JSONException {
        JSONArray actions = pending(context);
        JSONArray remaining = new JSONArray();
        for (int i = 0; i < actions.length(); i++) {
            JSONObject action = actions.getJSONObject(i);
            if (!id.equals(action.getString("id"))) remaining.put(action);
            else status(context, action, "reply".equals(action.getString("type")) ? "Reply sent" : null);
        }
        if (!prefs(context).edit().putString("pending", remaining.toString()).commit()) {
            throw new IllegalStateException("Could not acknowledge notification action");
        }
    }

    static synchronized void status(Context context, JSONObject action, String text) throws JSONException {
        String roomId = action.getString("roomId");
        Notification notification = find(context, roomId);
        if (notification == null || !action.getString("eventId").equals(notification.extras.getString(EVENT_ID))) return;
        Notification.Builder builder = Notification.Builder.recoverBuilder(context, notification)
            .setSubText(text).setOnlyAlertOnce(true);
        post(context, roomId, builder.build());
    }

    private static void post(Context context, String roomId, Notification notification) {
        try {
            NotificationManagerCompat.from(context).notify(roomId, roomId.hashCode() & 0x7fffffff, notification);
        } catch (SecurityException error) {
            Log.w(TAG, "Notification permission is not granted", error);
        }
    }
}
