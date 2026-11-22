import 'package:flutter/foundation.dart' show kIsWeb, defaultTargetPlatform, TargetPlatform;
import 'package:flutter/services.dart';

/// Snapchat-style screenshot detector for Benchly chat rooms.
/// - On Android 14+ (API 34+): listens to OS Activity.ScreenCaptureCallback via MethodChannel.
/// - On Web / Desktop: detects PrintScreen, Win+Shift+S, Cmd+Shift+3/4/5, and Ctrl+P shortcuts.
/// Fires [onScreenshotDetected] so the chat partner is notified in real time.
class ScreenshotGuard {
  static const MethodChannel _channel = MethodChannel('benchly/screenshot_guard');
  static VoidCallback? _onDetected;
  static bool _listening = false;
  static DateTime? _lastNotified;

  static void startListening({required VoidCallback onScreenshotDetected}) {
    _onDetected = onScreenshotDetected;
    if (_listening) return;
    _listening = true;

    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
      _channel.setMethodCallHandler((call) async {
        if (call.method == 'onScreenshotDetected') {
          _triggerDebounced();
        }
      });
    }

    HardwareKeyboard.instance.addHandler(_handleKeyEvent);
  }

  static void stopListening() {
    _onDetected = null;
    if (!_listening) return;
    _listening = false;
    HardwareKeyboard.instance.removeHandler(_handleKeyEvent);
    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
      _channel.setMethodCallHandler(null);
    }
  }

  static void _triggerDebounced() {
    final now = DateTime.now();
    if (_lastNotified != null && now.difference(_lastNotified!).inSeconds < 2) {
      return;
    }
    _lastNotified = now;
    _onDetected?.call();
  }

  static bool _handleKeyEvent(KeyEvent event) {
    if (!_listening || event is! KeyDownEvent) return false;

    final key = event.logicalKey;
    final ctrl = HardwareKeyboard.instance.isControlPressed;
    final meta = HardwareKeyboard.instance.isMetaPressed;
    final shift = HardwareKeyboard.instance.isShiftPressed;

    final isPrintScreen = key == LogicalKeyboardKey.printScreen;
    final isPrintPage = (ctrl || meta) && key == LogicalKeyboardKey.keyP;
    final isWinSnip = (meta || ctrl) && shift && key == LogicalKeyboardKey.keyS;
    final isMacShot = meta &&
        shift &&
        (key == LogicalKeyboardKey.digit3 ||
            key == LogicalKeyboardKey.digit4 ||
            key == LogicalKeyboardKey.digit5);

    if (isPrintScreen || isPrintPage || isWinSnip || isMacShot) {
      _triggerDebounced();
    }
    return false;
  }
}
