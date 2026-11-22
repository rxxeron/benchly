import 'dart:js_interop';
import 'dart:js_interop_unsafe';

Future<String> enableBenchlyNotifications() async {
  try {
    final promise = globalContext.callMethod('benchlyEnableNotifications'.toJS) as JSPromise<JSAny?>?;
    if (promise == null) return 'unsupported';
    final res = await promise.toDart;
    return res?.toString() ?? 'granted';
  } catch (_) {
    return 'error';
  }
}

void notifyBenchlyEvent(String title, String body, {String tag = 'benchly'}) {
  try {
    globalContext.callMethod('benchlyNotify'.toJS, title.toJS, body.toJS, tag.toJS);
  } catch (_) {}
}

Future<String> promptBenchlyPwaInstall() async {
  try {
    final promise = globalContext.callMethod('benchlyInstallPwa'.toJS) as JSPromise<JSAny?>?;
    if (promise == null) return 'unavailable';
    final res = await promise.toDart;
    return res?.toString() ?? 'unavailable';
  } catch (_) {
    return 'unavailable';
  }
}
