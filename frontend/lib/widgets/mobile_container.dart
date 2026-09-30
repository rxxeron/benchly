import 'package:flutter/material.dart';

class MobileContainer extends StatelessWidget {
  final Widget child;
  const MobileContainer({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        // If screen is mobile-sized, fill completely
        if (constraints.maxWidth <= 480) {
          return Container(
            color: const Color(0xFF0F1015),
            child: child,
          );
        }

        // On desktop web, frame it cleanly with subtle elevation
        return Container(
          color: const Color(0xFF07070A), // Ambient outer darkness
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 430),
              child: Container(
                width: double.infinity,
                height: double.infinity,
                decoration: BoxDecoration(
                  color: const Color(0xFF0F1015),
                  border: Border.symmetric(
                    vertical: BorderSide(
                      color: Colors.white.withValues(alpha: 0.08),
                      width: 1,
                    ),
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.6),
                      blurRadius: 32,
                      spreadRadius: 2,
                    ),
                  ],
                ),
                child: child,
              ),
            ),
          ),
        );
      },
    );
  }
}
