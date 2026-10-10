class AppConfig {
  // Socket server URL — override at build time with:
  // flutter run --dart-define=SOCKET_URL=https://your-server.com
  static const String socketUrl = String.fromEnvironment(
    'SOCKET_URL',
    defaultValue: 'https://api.benchly.live',
  );

  // Chat settings
  static const int chatDurationSeconds = 15 * 60; // 15 minutes
  static const int cooldownMinutes = 30;

  // Alias regeneration
  static const int aliasChangeCooldownDays = 30;

  // Message limits
  static const int maxMessageLength = 500;
  static const int maxMessagesPerSecond = 3;
}
