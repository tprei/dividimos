declare module "@capacitor/push-notifications" {
  interface PermissionStatus {
    receive: "prompt" | "prompt-with-rationale" | "granted" | "denied";
  }

  interface Token {
    value: string;
  }

  interface RegistrationError {
    error: string;
  }

  interface PushNotificationsPlugin {
    register(): Promise<void>;
    unregister(): Promise<void>;
    checkPermissions(): Promise<PermissionStatus>;
    requestPermissions(): Promise<PermissionStatus>;
    addListener(
      eventName: string,
      callback: (...args: unknown[]) => void,
    ): Promise<{ remove: () => Promise<void> }>;
    removeAllListeners(): Promise<void>;
  }

  export const PushNotifications: PushNotificationsPlugin;
}
