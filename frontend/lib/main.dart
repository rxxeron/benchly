import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'screens/auth_wrapper.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Supabase.initialize(
    url: 'https://pibrfwfazbuifanezovw.supabase.co',
    // ignore: deprecated_member_use
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpYnJmd2ZhemJ1aWZhbmV6b3Z3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA3NjM2MDcsImV4cCI6MjEwNjMzOTYwN30.H4VvZ2sXK0fqbTjz5SRW8FlmzAHuYmPQCI6G9nDWSNE',
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
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF080A0F),
        primaryColor: const Color(0xFF10B981),
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFF10B981),
          secondary: Color(0xFF6366F1),
          surface: Color(0xFF121622),
        ),
        fontFamily: 'Roboto',
        appBarTheme: const AppBarTheme(
          backgroundColor: Color(0xFF0F1015),
          elevation: 0,
          centerTitle: false,
          scrolledUnderElevation: 0,
        ),
      ),
      home: const AuthWrapper(),
    );
  }
}
