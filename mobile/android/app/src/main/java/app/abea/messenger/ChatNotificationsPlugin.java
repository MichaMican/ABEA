package app.abea.messenger;

import android.app.Notification;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.service.notification.StatusBarNotification;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

@CapacitorPlugin(name = "ChatNotifications")
public class ChatNotificationsPlugin extends Plugin {
    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            notifyListeners("actionsChanged", new JSObject());
        }
    };

    @Override
    public void load() {
        ContextCompat.registerReceiver(getContext(), receiver,
            new IntentFilter(ChatNotifications.ACTIONS_CHANGED), ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    @Override
    protected void handleOnDestroy() {
        getContext().unregisterReceiver(receiver);
    }

    @PluginMethod
    public void configure(PluginCall call) {
        ChatNotifications.configure(getContext(), call.getString("userId"), Boolean.TRUE.equals(call.getBoolean("enabled")));
        call.resolve();
    }

    @PluginMethod
    public void show(PluginCall call) {
        String roomId = call.getString("roomId");
        String eventId = call.getString("eventId");
        if (roomId == null || eventId == null) {
            call.reject("A room and event id are required");
            return;
        }
        ChatNotifications.show(getContext(), roomId, eventId, call.getString("roomName", "Chat"),
            call.getString("senderId", "unknown"), call.getString("senderName", "Someone"),
            call.getString("body", "New message"), Boolean.TRUE.equals(call.getBoolean("isDirect")),
            call.getLong("timestamp", System.currentTimeMillis()));
        call.resolve();
    }

    @PluginMethod
    public void delivered(PluginCall call) {
        JSArray result = new JSArray();
        for (StatusBarNotification notification : ChatNotifications.delivered(getContext())) {
            Notification value = notification.getNotification();
            JSObject item = new JSObject();
            item.put("roomId", value.extras.getString(ChatNotifications.ROOM_ID));
            item.put("eventId", value.extras.getString(ChatNotifications.EVENT_ID));
            result.put(item);
        }
        JSObject response = new JSObject();
        response.put("notifications", result);
        call.resolve(response);
    }

    @PluginMethod
    public void clear(PluginCall call) {
        String roomId = call.getString("roomId");
        if (roomId == null) {
            call.reject("A room id is required");
            return;
        }
        ChatNotifications.clear(getContext(), roomId, call.getString("eventId"));
        call.resolve();
    }

    @PluginMethod
    public void pending(PluginCall call) {
        try {
            JSObject result = new JSObject();
            result.put("actions", ChatNotifications.pending(getContext()));
            call.resolve(result);
        } catch (JSONException error) {
            call.reject("Could not read notification actions", error);
        }
    }

    @PluginMethod
    public void complete(PluginCall call) {
        String id = call.getString("id");
        if (id == null) {
            call.reject("An action id is required");
            return;
        }
        try {
            ChatNotifications.complete(getContext(), id);
            call.resolve();
        } catch (JSONException | IllegalStateException error) {
            call.reject("Could not acknowledge notification action", error);
        }
    }

    @PluginMethod
    public void status(PluginCall call) {
        String id = call.getString("id");
        try {
            JSONArray actions = ChatNotifications.pending(getContext());
            for (int i = 0; i < actions.length(); i++) {
                JSONObject action = actions.getJSONObject(i);
                if (action.getString("id").equals(id)) ChatNotifications.status(getContext(), action, call.getString("text"));
            }
            call.resolve();
        } catch (JSONException error) {
            call.reject("Could not update notification action", error);
        }
    }
}
