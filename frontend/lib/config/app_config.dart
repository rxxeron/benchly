import 'package:flutter/foundation.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';

class AppConfig {
  static String? _dotEnv(String key) =>
      dotenv.isInitialized ? dotenv.env[key] : null;

  static String get supabaseUrl {
    const defined = String.fromEnvironment('SUPABASE_URL');
    if (defined.isNotEmpty) return defined;
    return _dotEnv('SUPABASE_URL') ?? '';
  }

  static String get supabaseAnonKey {
    const defined = String.fromEnvironment('SUPABASE_ANON_KEY');
    if (defined.isNotEmpty) return defined;
    return _dotEnv('SUPABASE_ANON_KEY') ?? '';
  }

  static String get googleWebClientId {
    const defined = String.fromEnvironment('GOOGLE_WEB_CLIENT_ID');
    if (defined.isNotEmpty) return defined;
    return _dotEnv('GOOGLE_WEB_CLIENT_ID') ?? '';
  }

  static String get socketUrl {
    const defined = String.fromEnvironment('SOCKET_URL');
    if (defined.isNotEmpty) return defined;
    final envUrl = _dotEnv('SOCKET_URL') ?? '';
    if (envUrl.isNotEmpty) return envUrl;
    if (kIsWeb) {
      final host = Uri.base.host;
      if (host == 'localhost' ||
          host == '127.0.0.1' ||
          host.startsWith('192.168.') ||
          host.startsWith('10.')) {
        return Uri.base.origin;
      }
    }
    return 'https://api.benchly.live';
  }

  // Chat settings (synced with backend)
  static const int chatDurationSeconds = 15 * 60; // 15 minutes
  static const int cooldownSeconds = 15;
  static const int searchTimeoutSeconds = 40;

  // Alias regeneration
  static const int aliasChangeCooldownDays = 15;

  // Message limits
  static const int maxMessageLength = 500;
  static const int maxMessagesPerSecond = 3;
}
