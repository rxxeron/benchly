import 'package:flutter/material.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'config/app_config.dart';
import 'screens/auth_wrapper.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  if (!const bool.hasEnvironment('SUPABASE_URL')) {
    try {
      await dotenv.load(fileName: '.env');
    } catch (_) {
      // Prefer --dart-define / --dart-define-from-file in production builds so .env is never bundled as an asset.
    }
  }
  await Supabase.initialize(
    url: AppConfig.supabaseUrl,
    // ignore: deprecated_member_use
    anonKey: AppConfig.supabaseAnonKey,
    authOptions: const FlutterAuthClientOptions(
      authFlowType: AuthFlowType.pkce,
    ),
  );
  runApp(const BenchlyApp());
}

class BenchlyApp extends StatelessWidget {
  const BenchlyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Benchly',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.light,
        scaffoldBackgroundColor: const Color(0xFFFFF9F0),
        primaryColor: const Color(0xFF0FB881),
        colorScheme: const ColorScheme.light(
          primary: Color(0xFF0FB881),
          secondary: Color(0xFFFF6B4A),
          tertiary: Color(0xFFFFB800),
          surface: Color(0xFFFFFFFF),
          onSurface: Color(0xFF1E1B18),
        ),
        fontFamily: 'Roboto',
        appBarTheme: const AppBarTheme(
          backgroundColor: Color(0xFFFFF9F0),
          foregroundColor: Color(0xFF1E1B18),
          elevation: 0,
          centerTitle: false,
          scrolledUnderElevation: 0,
        ),
        bottomSheetTheme: const BottomSheetThemeData(
          constraints: BoxConstraints(maxWidth: 430),
        ),
      ),
      home: const AuthWrapper(),
    );
  }
}
