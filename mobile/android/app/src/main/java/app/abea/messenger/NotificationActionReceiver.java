package app.abea.messenger;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import androidx.core.app.RemoteInput;
import java.util.UUID;
import org.json.JSONException;
import org.json.JSONObject;

public class NotificationActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        boolean reply = ChatNotifications.REPLY.equals(intent.getAction());
        if (!reply && !ChatNotifications.READ.equals(intent.getAction())) return;
        String roomId = intent.getStringExtra(ChatNotifications.ROOM_ID);
        String eventId = intent.getStringExtra(ChatNotifications.EVENT_ID);
        String userId = intent.getStringExtra(ChatNotifications.USER_ID);
        if (roomId == null || eventId == null || userId == null || !userId.equals(ChatNotifications.userId(context))) {
            Log.w("ABEA.Notifications", "Ignoring a notification action for a signed-out account");
            return;
        }
        try {
            JSONObject action = new JSONObject()
                .put("id", UUID.randomUUID().toString())
                .put("type", reply ? "reply" : "read")
                .put("roomId", roomId)
                .put("eventId", eventId)
                .put("userId", userId);
            if (reply) {
                Bundle results = RemoteInput.getResultsFromIntent(intent);
                CharSequence text = results == null ? null : results.getCharSequence(ChatNotifications.REPLY_KEY);
                if (text == null || text.toString().trim().isEmpty()) {
                    Log.w("ABEA.Notifications", "Ignoring an empty notification reply");
                    return;
                }
                action.put("reply", text.toString());
            }
            ChatNotifications.enqueue(context, action);
            // Never report success before Matrix accepts the action. If Android killed the WebView,
            // tapping the chat resumes the encrypted client and drains this durable queue.
            ChatNotifications.status(context, action, reply ? "Open ABEA to send your reply" : "Open ABEA to mark as read");
            context.sendBroadcast(new Intent(ChatNotifications.ACTIONS_CHANGED).setPackage(context.getPackageName()));
        } catch (JSONException | IllegalStateException error) {
            Log.e("ABEA.Notifications", "Could not queue notification action", error);
        }
    }
}
