# Flutter wrapper & engine
-keep class io.flutter.app.** { *; }
-keep class io.flutter.plugin.** { *; }
-keep class io.flutter.util.** { *; }
-keep class io.flutter.view.** { *; }
-keep class io.flutter.** { *; }
-keep class io.flutter.plugins.** { *; }
-dontwarn io.flutter.embedding.**

# Google Sign-In / Play Services / Credentials
-keep class com.google.android.gms.** { *; }
-keep class androidx.credentials.** { *; }
-dontwarn com.google.android.gms.**

# App Links / Deep Linking
-keep class com.llfbandit.app_links.** { *; }
-dontwarn com.llfbandit.app_links.**

# Kotlin metadata & coroutines
-keepclassmembers class * {
    @androidx.annotation.Keep <methods>;
    @androidx.annotation.Keep <fields>;
}
-dontwarn kotlinx.coroutines.**
