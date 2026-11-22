import 'package:flutter/material.dart';

/// GPU-composited staggered entrance animation (Transform + Opacity only, 60fps)
/// Honors prefers-reduced-motion via MediaQuery.disableAnimationsOf.
class StaggeredReveal extends StatefulWidget {
  final Widget child;
  final int index;
  final Duration baseDelay;
  final Duration duration;
  final Offset slideOffset;
  final double initialScale;

  const StaggeredReveal({
    super.key,
    required this.child,
    this.index = 0,
    this.baseDelay = const Duration(milliseconds: 55),
    this.duration = const Duration(milliseconds: 420),
    this.slideOffset = const Offset(0, 16),
    this.initialScale = 0.97,
  });

  @override
  State<StaggeredReveal> createState() => _StaggeredRevealState();
}

class _StaggeredRevealState extends State<StaggeredReveal>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _curved;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this, duration: widget.duration);
    _curved = CurvedAnimation(
      parent: _controller,
      curve: Curves.easeOutCubic,
    );

    final delayMs = (widget.index * widget.baseDelay.inMilliseconds).clamp(0, 600);
    Future.delayed(Duration(milliseconds: delayMs), () {
      if (mounted) _controller.forward();
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final reduceMotion = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    if (reduceMotion) return widget.child;

    return AnimatedBuilder(
      animation: _curved,
      child: widget.child,
      builder: (context, child) {
        final t = _curved.value;
        final dx = widget.slideOffset.dx * (1.0 - t);
        final dy = widget.slideOffset.dy * (1.0 - t);
        final scale = widget.initialScale + (1.0 - widget.initialScale) * t;

        return Opacity(
          opacity: t.clamp(0.0, 1.0),
          child: Transform.translate(
            offset: Offset(dx, dy),
            child: Transform.scale(
              scale: scale,
              child: child,
            ),
          ),
        );
      },
    );
  }
}

/// Fast 140ms micro-interaction tap/hover spring wrapper (scale 0.96 on tap, 1.015 on hover).
class SpringTap extends StatefulWidget {
  final Widget child;
  final VoidCallback? onTap;
  final double tapScale;
  final double hoverScale;

  const SpringTap({
    super.key,
    required this.child,
    this.onTap,
    this.tapScale = 0.96,
    this.hoverScale = 1.015,
  });

  @override
  State<SpringTap> createState() => _SpringTapState();
}

class _SpringTapState extends State<SpringTap> {
  bool _pressed = false;
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    final targetScale = _pressed
        ? widget.tapScale
        : (_hovered ? widget.hoverScale : 1.0);

    final scaledChild = AnimatedScale(
      scale: targetScale,
      duration: const Duration(milliseconds: 140),
      curve: Curves.easeOutCubic,
      child: widget.child,
    );

    return MouseRegion(
      cursor: widget.onTap != null ? SystemMouseCursors.click : MouseCursor.defer,
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() {
        _hovered = false;
        _pressed = false;
      }),
      child: widget.onTap != null
          ? GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTapDown: (_) => setState(() => _pressed = true),
              onTapUp: (_) {
                setState(() => _pressed = false);
                widget.onTap?.call();
              },
              onTapCancel: () => setState(() => _pressed = false),
              child: scaledChild,
            )
          : Listener(
              onPointerDown: (_) => setState(() => _pressed = true),
              onPointerUp: (_) => setState(() => _pressed = false),
              onPointerCancel: (_) => setState(() => _pressed = false),
              child: scaledChild,
            ),
    );
  }
}
