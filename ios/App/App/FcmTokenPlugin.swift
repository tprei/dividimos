import Capacitor
import FirebaseCore
import FirebaseMessaging

// Android's PushNotifications.unregister() deletes the FCM token natively; on
// iOS it only stops APNs delivery, so a stale server row could still reach this
// device. Deleting the token makes FCM reject any send to it.
@objc(FcmTokenPlugin)
public class FcmTokenPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FcmTokenPlugin"
    public let jsName = "FcmToken"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "deleteToken", returnType: CAPPluginReturnPromise)
    ]

    @objc func deleteToken(_ call: CAPPluginCall) {
        guard FirebaseApp.app() != nil else {
            call.resolve()
            return
        }
        Messaging.messaging().deleteToken { error in
            if let error = error {
                call.reject(error.localizedDescription, nil, error)
            } else {
                call.resolve()
            }
        }
    }
}
