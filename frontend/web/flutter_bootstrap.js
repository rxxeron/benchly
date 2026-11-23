{{flutter_js}}
{{flutter_build_config}}

// Boot Flutter without registering Flutter's deprecated self-unregistering
// flutter_service_worker.js (which conflicted with /benchly-sw.js on scope '/'
// and caused a full-page reload loop).
_flutter.loader.load();
