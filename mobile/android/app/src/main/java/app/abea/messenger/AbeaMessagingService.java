package app.abea.messenger;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;
import org.json.JSONObject;

/**
 * Receives Matrix push notifications (relayed by a Sygnal push gateway through FCM) and shows them
 * while ABEA is in the background. In the foreground the web layer handles messages via /sync.
 */
public class AbeaMessagingService extends MessagingService {

    public static final String CHANNEL_ID = "messages";

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);
        if (MainActivity.isInForeground()) return;

        Map<String, String> data = remoteMessage.getData();
        String roomId = data.get("room_id");
        if (roomId == null) return;
        int id = roomId.hashCode() & 0x7fffffff;

        // Sygnal sends a push with unread == 0 when the user has read the room elsewhere.
        if ("0".equals(data.get("unread")) && data.get("event_id") == null) {
            NotificationManagerCompat.from(this).cancel(id);
            return;
        }
        if (!NotificationManagerCompat.from(this).areNotificationsEnabled()) return;

        String sender = firstNonEmpty(data.get("sender_display_name"), data.get("sender"), "Someone");
        String roomName = data.get("room_name");
        String title = roomName != null && !roomName.isEmpty() && !roomName.equals(sender) ? roomName : sender;
        String body = describe(data);
        if (!title.equals(sender)) body = sender + ": " + body;

        ensureChannel(this);
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("abea://room/" + Uri.encode(roomId)), this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pending = PendingIntent.getActivity(this, id, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_abea)
            .setColor(0xFF6A6DFF)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setGroup("abea.messages")
            .setAutoCancel(true)
            .setContentIntent(pending);

        try {
            NotificationManagerCompat.from(this).notify(id, builder.build());
        } catch (SecurityException ignored) {
            // POST_NOTIFICATIONS was revoked.
        }
    }

    private static String describe(Map<String, String> data) {
        String type = data.get("type");
        if ("m.room.encrypted".equals(type)) return "🔒 New encrypted message";
        if ("m.room.member".equals(type)) return "invited you to a chat";
        String raw = data.get("content");
        if (raw != null) {
            try {
                JSONObject content = new JSONObject(raw);
                String msgtype = content.optString("msgtype");
                switch (msgtype) {
                    case "m.image":
                        return "📷 Photo";
                    case "m.video":
                        return "🎬 Video";
                    case "m.audio":
                        return "🎤 Audio";
                    case "m.file":
                        return "📎 File";
                    default:
                        String text = content.optString("body");
                        if (!text.isEmpty()) return text;
                }
            } catch (Exception ignored) {
                // Content is only present for unencrypted rooms.
            }
        }
        return "New message";
    }

    private static String firstNonEmpty(String... values) {
        for (String v : values) if (v != null && !v.isEmpty()) return v;
        return "";
    }

    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Messages", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("New messages in your chats");
        channel.enableVibration(true);
        manager.createNotificationChannel(channel);
    }
}
