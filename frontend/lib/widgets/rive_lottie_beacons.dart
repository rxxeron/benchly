import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:lottie/lottie.dart';

enum RadarMachineState {
  idle,
  scanning1v1,
  groupHauntClustering,
  matchLocked,
}

/// 60fps Hybrid Rive State-Machine + Lottie Vector Matchmaking Radar Beacon.
/// Reacts to pointer hover tilt, state transitions, and renders orbital EWU student nodes.
class RiveLottieRadarBeacon extends StatefulWidget {
  final RadarMachineState state;
  final int countdownSeconds;
  final String activeTopic;
  final VoidCallback? onTriggerPulse;

  const RiveLottieRadarBeacon({
    super.key,
    required this.state,
    this.countdownSeconds = 35,
    this.activeTopic = 'EWU Adda Live',
    this.onTriggerPulse,
  });

  @override
  State<RiveLottieRadarBeacon> createState() => _RiveLottieRadarBeaconState();
}

class _RiveLottieRadarBeaconState extends State<RiveLottieRadarBeacon>
    with SingleTickerProviderStateMixin {
  late final AnimationController _orbitController;
  Offset _pointerTilt = Offset.zero;
  double _burstEnergy = 0.0;

  @override
  void initState() {
    super.initState();
    _orbitController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 6),
    )..repeat();
  }

  @override
  void dispose() {
    _orbitController.dispose();
    super.dispose();
  }

  void _triggerEnergyPulse() {
    setState(() => _burstEnergy = 1.0);
    widget.onTriggerPulse?.call();
    Future.delayed(const Duration(milliseconds: 450), () {
      if (mounted) setState(() => _burstEnergy = 0.0);
    });
  }

  @override
  Widget build(BuildContext context) {
    final isGroup = widget.state == RadarMachineState.groupHauntClustering;
    final primaryColor = isGroup ? const Color(0xFF6366F1) : const Color(0xFF0FB881);

    return MouseRegion(
      onHover: (e) {
        final dx = ((e.localPosition.dx - 110) / 110).clamp(-1.0, 1.0);
        final dy = ((e.localPosition.dy - 110) / 110).clamp(-1.0, 1.0);
        setState(() => _pointerTilt = Offset(dx * 0.14, -dy * 0.14));
      },
      onExit: (_) => setState(() => _pointerTilt = Offset.zero),
      child: GestureDetector(
        onTap: _triggerEnergyPulse,
        child: TweenAnimationBuilder<Offset>(
          tween: Tween<Offset>(begin: Offset.zero, end: _pointerTilt),
          duration: const Duration(milliseconds: 180),
          builder: (context, tilt, child) {
            return Transform(
              alignment: Alignment.center,
              transform: Matrix4.identity()
                ..setEntry(3, 2, 0.0015)
                ..rotateY(tilt.dx)
                ..rotateX(tilt.dy),
              child: child,
            );
          },
          child: SizedBox(
            width: 210,
            height: 210,
            child: Stack(
              alignment: Alignment.center,
              children: [
                // 1. Custom 60fps State-Machine Orbital Graph Painter
                AnimatedBuilder(
                  animation: _orbitController,
                  builder: (context, _) {
                    return CustomPaint(
                      size: const Size(210, 210),
                      painter: _RadarStateMachinePainter(
                        progress: _orbitController.value,
                        primaryColor: primaryColor,
                        isGroupMode: isGroup,
                        burstEnergy: _burstEnergy,
                      ),
                    );
                  },
                ),

                // 2. Native Lottie Vector Radar Pulse Overlay
                SizedBox(
                  width: 150,
                  height: 150,
                  child: Lottie.asset(
                    'assets/animations/radar_pulse.json',
                    fit: BoxFit.contain,
                    repeat: true,
                  ),
                ),

                // 3. Central Interactive Core Badge
                AnimatedContainer(
                  duration: const Duration(milliseconds: 220),
                  width: 64 + (_burstEnergy * 10),
                  height: 64 + (_burstEnergy * 10),
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: LinearGradient(
                      colors: isGroup
                          ? const [Color(0xFF6366F1), Color(0xFF8B5CF6)]
                          : const [Color(0xFF0FB881), Color(0xFF059669)],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: primaryColor.withValues(alpha: 0.45),
                        blurRadius: 22,
                        spreadRadius: 2,
                      ),
                    ],
                  ),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(
                        isGroup ? Icons.groups_rounded : Icons.radar_rounded,
                        color: const Color(0xFF1E1B18),
                        size: 24,
                      ),
                      Text(
                        '${widget.countdownSeconds}s',
                        style: const TextStyle(
                          color: const Color(0xFF1E1B18),
                          fontSize: 11,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _RadarStateMachinePainter extends CustomPainter {
  final double progress;
  final Color primaryColor;
  final bool isGroupMode;
  final double burstEnergy;

  _RadarStateMachinePainter({
    required this.progress,
    required this.primaryColor,
    required this.isGroupMode,
    required this.burstEnergy,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final maxR = size.width / 2 - 8;

    // Concentric radar grid rings
    final ringPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.2
      ..color = primaryColor.withValues(alpha: 0.22 + burstEnergy * 0.25);

    for (final factor in [0.45, 0.72, 0.96]) {
      canvas.drawCircle(center, maxR * factor, ringPaint);
    }

    // Rotating sweep sector
    final sweepAngle = progress * 2 * math.pi;
    final sweepPaint = Paint()
      ..shader = SweepGradient(
        colors: [
          primaryColor.withValues(alpha: 0.0),
          primaryColor.withValues(alpha: 0.30),
        ],
        startAngle: 0.0,
        endAngle: math.pi / 2,
        transform: GradientRotation(sweepAngle - math.pi / 2),
      ).createShader(Rect.fromCircle(center: center, radius: maxR));

    canvas.drawCircle(center, maxR * 0.95, sweepPaint);

    // Orbiting EWU Department candidate nodes (Edmonds-Karp / Kruskal nodes)
    final nodeCount = isGroupMode ? 5 : 4;
    final nodeOffsets = <Offset>[];
    for (var i = 0; i < nodeCount; i++) {
      final angle = sweepAngle * (i.isEven ? 1 : -0.7) + (i * 2 * math.pi / nodeCount);
      final r = maxR * (0.62 + 0.22 * math.sin(progress * 2 * math.pi + i));
      final pos = Offset(
        center.dx + r * math.cos(angle),
        center.dy + r * math.sin(angle),
      );
      nodeOffsets.add(pos);
    }

    // Draw graph edges between candidate student nodes
    final edgePaint = Paint()
      ..color = primaryColor.withValues(alpha: isGroupMode ? 0.45 : 0.28)
      ..strokeWidth = 1.4;
    for (var i = 0; i < nodeOffsets.length; i++) {
      canvas.drawLine(center, nodeOffsets[i], edgePaint);
      if (isGroupMode) {
        final nxt = nodeOffsets[(i + 1) % nodeOffsets.length];
        canvas.drawLine(nodeOffsets[i], nxt, edgePaint);
      }
    }

    // Draw student ping nodes
    final dotPaint = Paint()..color = Colors.white;
    final haloPaint = Paint()..color = primaryColor.withValues(alpha: 0.45);
    for (final pt in nodeOffsets) {
      canvas.drawCircle(pt, 7 + burstEnergy * 3, haloPaint);
      canvas.drawCircle(pt, 3.5, dotPaint);
    }
  }

  @override
  bool shouldRepaint(covariant _RadarStateMachinePainter oldDelegate) {
    return oldDelegate.progress != progress ||
        oldDelegate.isGroupMode != isGroupMode ||
        oldDelegate.burstEnergy != burstEnergy;
  }
}

/// Lottie Stone Gem Badge Widget
class LottieStoneGem extends StatelessWidget {
  final double size;
  const LottieStoneGem({super.key, this.size = 38});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: Lottie.asset(
        'assets/animations/stone_gem.json',
        fit: BoxFit.contain,
        repeat: true,
      ),
    );
  }
}
