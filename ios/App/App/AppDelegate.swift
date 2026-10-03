import UIKit
import Capacitor
import FirebaseCore
import FirebaseMessaging

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, MessagingDelegate {

    var window: UIWindow?
    private var lastForwardedFcmToken: String?
    private var pendingTokenRequests = 0

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        if Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil {
            FirebaseApp.configure()
            Messaging.messaging().delegate = self
        }
        return true
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }

    // The server only accepts FCM registration tokens, so the APNs token goes
    // to Firebase and only the FCM token reaches JS, through the push plugin's
    // "registration" event. Each register() call gets exactly one event even
    // when the token is unchanged, or the JS side times out; rotations outside
    // that window are forwarded only when the token is new.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        guard FirebaseApp.app() != nil else {
            failRegistration(FcmRegistrationError.firebaseNotConfigured)
            return
        }
        pendingTokenRequests += 1
        Messaging.messaging().apnsToken = deviceToken
        Messaging.messaging().token { [weak self] token, error in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.pendingTokenRequests -= 1
                if let token = token {
                    self.post(fcmToken: token)
                } else {
                    self.failRegistration(error ?? FcmRegistrationError.missingToken)
                }
            }
        }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        failRegistration(error)
    }

    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        DispatchQueue.main.async {
            guard let fcmToken = fcmToken,
                  self.pendingTokenRequests == 0,
                  UIApplication.shared.isRegisteredForRemoteNotifications,
                  fcmToken != self.lastForwardedFcmToken else { return }
            self.post(fcmToken: fcmToken)
        }
    }

    private func post(fcmToken: String) {
        lastForwardedFcmToken = fcmToken
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: fcmToken)
    }

    private func failRegistration(_ error: Error) {
        DispatchQueue.main.async {
            NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
        }
    }
}

enum FcmRegistrationError: LocalizedError {
    case firebaseNotConfigured
    case missingToken

    var errorDescription: String? {
        switch self {
        case .firebaseNotConfigured:
            return "Firebase is not configured in this build (GoogleService-Info.plist is missing)."
        case .missingToken:
            return "Firebase returned no FCM registration token."
        }
    }
}
