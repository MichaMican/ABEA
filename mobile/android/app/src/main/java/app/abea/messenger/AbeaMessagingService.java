package app.abea.messenger;

import android.util.Log;
import androidx.annotation.NonNull;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;
import org.json.JSONException;
import org.json.JSONObject;

/** Renders Matrix pushes with the same conversation UI as messages received through /sync. */
public class AbeaMessagingService extends MessagingService {
    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);
        Map<String, String> data = remoteMessage.getData();
        // Badge-only updates contain an account-wide unread count, often without a room id.
        // Process these even in the foreground and before requiring an event.
        if ("0".equals(data.get("unread")) && empty(data.get("event_id"))) {
            ChatNotifications.clearAll(this);
            return;
        }
        String roomId = data.get("room_id");
        String eventId = data.get("event_id");
        if (empty(roomId) || empty(eventId) || MainActivity.isInForeground()) return;

        String sender = firstNonEmpty(data.get("sender_display_name"), data.get("sender"), "Someone");
        String roomName = firstNonEmpty(data.get("room_name"), sender);
        ChatNotifications.show(this, roomId, eventId, roomName, firstNonEmpty(data.get("sender"), sender),
            sender, describe(data), empty(data.get("room_name")) || roomName.equals(sender),
            remoteMessage.getSentTime() > 0 ? remoteMessage.getSentTime() : System.currentTimeMillis());
    }

    private static String describe(Map<String, String> data) {
        if ("m.room.encrypted".equals(data.get("type"))) return "New encrypted message";
        if ("m.room.member".equals(data.get("type"))) return "Invited you to a chat";
        // Sygnal's FCM v1 transport flattens content into content_* string fields.
        String msgtype = data.get("content_msgtype");
        String body = data.get("content_body");
        if (data.get("content") != null) {
            try {
                JSONObject content = new JSONObject(data.get("content"));
                msgtype = content.optString("msgtype");
                body = content.optString("body");
            } catch (JSONException error) {
                Log.w("ABEA.Notifications", "Push contained invalid message content", error);
            }
        }
        if ("m.image".equals(msgtype)) return "Photo";
        if ("m.video".equals(msgtype)) return "Video";
        if ("m.audio".equals(msgtype)) return "Audio";
        if ("m.file".equals(msgtype)) return "File";
        return firstNonEmpty(body, "New message");
    }

    private static boolean empty(String value) {
        return value == null || value.isEmpty();
    }

    private static String firstNonEmpty(String... values) {
        for (String value : values) if (!empty(value)) return value;
        return "";
    }
}
