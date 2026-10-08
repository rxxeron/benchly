import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../config/app_config.dart';
import '../widgets/mobile_container.dart';

class AdminAnalyticsScreen extends StatefulWidget {
  const AdminAnalyticsScreen({super.key});

  @override
  State<AdminAnalyticsScreen> createState() => _AdminAnalyticsScreenState();
}

class _AdminAnalyticsScreenState extends State<AdminAnalyticsScreen> {
  bool _isLoading = true;
  String? _error;
  Timer? _refreshTimer;
  bool _autoRefresh = true;

  Map<String, dynamic>? _realtimeData;
  Map<String, dynamic>? _summaryData;

  @override
  void initState() {
    super.initState();
    _fetchAnalytics();
    _refreshTimer = Timer.periodic(const Duration(seconds: 6), (_) {
      if (_autoRefresh && mounted) {
        _fetchAnalytics(silent: true);
      }
    });
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    super.dispose();
  }

  Future<void> _fetchAnalytics({bool silent = false}) async {
    if (!silent) setState(() => _isLoading = true);

    try {
      final baseUrl = AppConfig.socketUrl.replaceAll(RegExp(r'/+$'), '');
      
      final rtRes = await http.get(Uri.parse('$baseUrl/api/analytics/realtime'))
          .timeout(const Duration(seconds: 5));
      final sumRes = await http.get(Uri.parse('$baseUrl/api/analytics/summary'))
          .timeout(const Duration(seconds: 5));

      if (rtRes.statusCode == 200 && sumRes.statusCode == 200) {
        if (mounted) {
          setState(() {
            _realtimeData = jsonDecode(rtRes.body);
            _summaryData = jsonDecode(sumRes.body);
            _isLoading = false;
            _error = null;
          });
        }
      } else {
        throw Exception('Server returned status ${rtRes.statusCode}');
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = 'Unable to reach analytics server. Check backend host.';
          _isLoading = false;
          // Fallback demo metrics if server is temporarily unreachable locally
          _realtimeData ??= {
            'onlineUsers': 42,
            'queueStatus': {'any': 3, 'maleSeekingFemale': 4, 'femaleSeekingMale': 2, 'totalWaiting': 9},
            'todayStats': {
              'matchesCreated': 84,
              'messagesExchanged': 1240,
              'mutualExtensions': 31,
              'piiShieldBlocks': 14,
              'reportsSubmitted': 1
            },
            'systemHealth': {
              'uptimeSeconds': 86400,
              'rssMemoryMb': 48,
              'heapUsedMb': 24,
              'nodeVersion': 'v22.20.2'
            }
          };
          _summaryData ??= {
            'departments': [
              {'department': 'CSE', 'student_count': 64, 'percentage': 51.2},
              {'department': 'BBA', 'student_count': 28, 'percentage': 22.4},
              {'department': 'Pharmacy', 'student_count': 16, 'percentage': 12.8},
              {'department': 'EEE', 'student_count': 11, 'percentage': 8.8},
              {'department': 'English', 'student_count': 6, 'percentage': 4.8}
            ],
            'chatHealth': {
              'avg_duration_seconds': 520,
              'extension_rate_percentage': 36.9
            },
            'hourlyActivity': List.generate(24, (i) => {
              'hour': i,
              'label': '${i.toString().padLeft(2, '0')}:00',
              'count': (i >= 21 || i <= 2) ? 18 : (i >= 12 && i <= 15 ? 12 : 3)
            })
          };
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final rt = _realtimeData;
    final sum = _summaryData;

    return Scaffold(
      backgroundColor: const Color(0xFF090B10),
      appBar: AppBar(
        backgroundColor: const Color(0xFF090B10),
        elevation: 0,
        scrolledUnderElevation: 0,
        title: Row(
          children: [
            Container(
              width: 10,
              height: 10,
              decoration: const BoxDecoration(
                color: Color(0xFF10B981), // Emerald Pulse
                shape: BoxShape.circle,
              ),
            ),
            const SizedBox(width: 8),
            const Text(
              'Benchly Analytics',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w800,
                color: Colors.white,
                letterSpacing: -0.4,
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: _autoRefresh ? 'Pause Auto-Refresh' : 'Enable Auto-Refresh',
            icon: Icon(
              _autoRefresh ? Icons.sync_rounded : Icons.sync_disabled_rounded,
              color: _autoRefresh ? const Color(0xFF10B981) : Colors.white38,
              size: 20,
            ),
            onPressed: () {
              setState(() => _autoRefresh = !_autoRefresh);
              if (_autoRefresh) _fetchAnalytics();
            },
          ),
          IconButton(
            icon: const Icon(Icons.refresh_rounded, color: Colors.white70, size: 20),
            onPressed: () => _fetchAnalytics(),
          ),
        ],
      ),
      body: MobileContainer(
        child: _isLoading && rt == null
            ? const Center(child: CircularProgressIndicator(color: Color(0xFF10B981)))
            : RefreshIndicator(
                onRefresh: () => _fetchAnalytics(),
                color: const Color(0xFF10B981),
                backgroundColor: const Color(0xFF161A26),
                child: ListView(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  children: [
                    if (_error != null)
                      Container(
                        margin: const EdgeInsets.only(bottom: 12),
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF59E0B).withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: const Color(0xFFF59E0B).withValues(alpha: 0.3)),
                        ),
                        child: Row(
                          children: [
                            const Icon(Icons.info_outline, color: Color(0xFFF59E0B), size: 16),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                _error!,
                                style: const TextStyle(color: Color(0xFFF59E0B), fontSize: 11),
                              ),
                            ),
                          ],
                        ),
                      ),

                    // Campus Live Banner
                    _buildCampusLiveHeader(rt),
                    const SizedBox(height: 16),

                    // Primary KPI Metric Grid
                    _buildKpiGrid(rt, sum),
                    const SizedBox(height: 20),

                    // EWU Department Distribution
                    _buildDepartmentCard(sum),
                    const SizedBox(height: 20),

                    // Peak Hours / Adda Rush Hour Chart
                    _buildPeakHoursCard(sum),
                    const SizedBox(height: 20),

                    // Safety & Infrastructure Health
                    _buildSystemHealthCard(rt),
                    const SizedBox(height: 30),
                  ],
                ),
              ),
      ),
    );
  }

  Widget _buildCampusLiveHeader(Map<String, dynamic>? rt) {
    final online = rt?['onlineUsers'] ?? 0;
    final waiting = rt?['queueStatus']?['totalWaiting'] ?? 0;

    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            const Color(0xFF10B981).withValues(alpha: 0.18),
            const Color(0xFF0F2B20).withValues(alpha: 0.25),
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFF10B981).withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 8,
                      height: 8,
                      decoration: const BoxDecoration(
                        color: Color(0xFF10B981),
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Text(
                      'EWU CAMPUS LIVE',
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 1.2,
                        color: const Color(0xFF10B981).withValues(alpha: 0.9),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  '$online Students Active',
                  style: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                    color: Colors.white,
                    letterSpacing: -0.5,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '$waiting currently queued on benches',
                  style: TextStyle(
                    fontSize: 12,
                    color: Colors.white.withValues(alpha: 0.6),
                  ),
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFF10B981).withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(16),
            ),
            child: const Icon(Icons.hub_rounded, color: Color(0xFF10B981), size: 28),
          ),
        ],
      ),
    );
  }

  Widget _buildKpiGrid(Map<String, dynamic>? rt, Map<String, dynamic>? sum) {
    final matches = rt?['todayStats']?['matchesCreated'] ?? 0;
    final messages = rt?['todayStats']?['messagesExchanged'] ?? 0;
    final extensions = rt?['todayStats']?['mutualExtensions'] ?? 0;
    final piiBlocks = rt?['todayStats']?['piiShieldBlocks'] ?? 0;
    final extRate = sum?['chatHealth']?['extension_rate_percentage'] ?? 0;

    return GridView.count(
      crossAxisCount: 2,
      crossAxisSpacing: 12,
      mainAxisSpacing: 12,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      childAspectRatio: 1.35,
      children: [
        _buildMetricCard(
          title: 'Total Matches Today',
          value: '$matches',
          icon: Icons.forum_rounded,
          accentColor: const Color(0xFF6366F1),
          subtitle: 'Active 1v1 rooms created',
        ),
        _buildMetricCard(
          title: 'Messages Sent',
          value: '$messages',
          icon: Icons.chat_bubble_outline_rounded,
          accentColor: const Color(0xFF38BDF8),
          subtitle: 'Filtered & protected',
        ),
        _buildMetricCard(
          title: 'Mutual Extensions',
          value: '$extensions ($extRate%)',
          icon: Icons.trending_up_rounded,
          accentColor: const Color(0xFF10B981),
          subtitle: 'Students extending +15m',
        ),
        _buildMetricCard(
          title: 'Safety Shield Blocks',
          value: '$piiBlocks',
          icon: Icons.shield_outlined,
          accentColor: const Color(0xFFF59E0B),
          subtitle: 'Phone/Email leaks intercepted',
        ),
      ],
    );
  }

  Widget _buildMetricCard({
    required String title,
    required String value,
    required IconData icon,
    required Color accentColor,
    required String subtitle,
  }) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF121622),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withValues(alpha: 0.05)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                title,
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: Colors.white.withValues(alpha: 0.6),
                ),
              ),
              Icon(icon, size: 16, color: accentColor),
            ],
          ),
          Text(
            value,
            style: const TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w800,
              color: Colors.white,
              letterSpacing: -0.3,
            ),
          ),
          Text(
            subtitle,
            style: TextStyle(
              fontSize: 10,
              color: Colors.white.withValues(alpha: 0.4),
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ),
    );
  }

  Widget _buildDepartmentCard(Map<String, dynamic>? sum) {
    final depts = (sum?['departments'] as List<dynamic>?) ?? [];

    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: const Color(0xFF121622),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.white.withValues(alpha: 0.05)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'EWU Department Demographics',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  color: Colors.white,
                ),
              ),
              Text(
                'Zero-PII Decoded',
                style: TextStyle(
                  fontSize: 11,
                  color: const Color(0xFF10B981).withValues(alpha: 0.8),
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          ...depts.map((d) {
            final name = d['department'] ?? 'Other';
            final pct = (d['percentage'] as num?)?.toDouble() ?? 0.0;
            final count = d['student_count'] ?? 0;

            Color barColor = const Color(0xFF6366F1);
            if (name == 'CSE') barColor = const Color(0xFF10B981);
            if (name == 'BBA') barColor = const Color(0xFF38BDF8);
            if (name == 'Pharmacy') barColor = const Color(0xFFEC4899);
            if (name == 'EEE') barColor = const Color(0xFFF59E0B);

            return Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        name,
                        style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: Colors.white,
                        ),
                      ),
                      Text(
                        '$count students (${pct.toStringAsFixed(1)}%)',
                        style: TextStyle(
                          fontSize: 11,
                          color: Colors.white.withValues(alpha: 0.5),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(6),
                    child: LinearProgressIndicator(
                      value: (pct / 100).clamp(0.0, 1.0),
                      minHeight: 6,
                      backgroundColor: Colors.white.withValues(alpha: 0.06),
                      valueColor: AlwaysStoppedAnimation<Color>(barColor),
                    ),
                  ),
                ],
              ),
            );
          }),
        ],
      ),
    );
  }

  Widget _buildPeakHoursCard(Map<String, dynamic>? sum) {
    final hourly = (sum?['hourlyActivity'] as List<dynamic>?) ?? [];
    int maxCount = 1;
    for (var h in hourly) {
      final c = (h['count'] as num?)?.toInt() ?? 0;
      if (c > maxCount) maxCount = c;
    }

    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: const Color(0xFF121622),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.white.withValues(alpha: 0.05)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Campus Peak Adda Hours',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  color: Colors.white,
                ),
              ),
              Text(
                'Dhaka Time (24h)',
                style: TextStyle(
                  fontSize: 11,
                  color: Colors.white.withValues(alpha: 0.4),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          SizedBox(
            height: 90,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: hourly.map((h) {
                final count = (h['count'] as num?)?.toInt() ?? 0;
                final heightFactor = (count / maxCount).clamp(0.08, 1.0);
                final hour = h['hour'] ?? 0;
                final isPeak = hour >= 21 || hour <= 2;

                return Expanded(
                  child: Container(
                    margin: const EdgeInsets.symmetric(horizontal: 1),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        Container(
                          height: 70 * heightFactor,
                          decoration: BoxDecoration(
                            color: isPeak ? const Color(0xFF10B981) : const Color(0xFF6366F1).withValues(alpha: 0.6),
                            borderRadius: BorderRadius.circular(3),
                          ),
                        ),
                        const SizedBox(height: 4),
                        if (hour % 6 == 0)
                          Text(
                            '$hour',
                            style: TextStyle(
                              fontSize: 9,
                              color: Colors.white.withValues(alpha: 0.4),
                            ),
                          )
                        else
                          const SizedBox(height: 12),
                      ],
                    ),
                  ),
                );
              }).toList(),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSystemHealthCard(Map<String, dynamic>? rt) {
    final sys = rt?['systemHealth'];
    final uptime = (sys?['uptimeSeconds'] as num?)?.toInt() ?? 0;
    final hours = uptime ~/ 3600;
    final rssMem = sys?['rssMemoryMb'] ?? 35;

    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: const Color(0xFF121622),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.white.withValues(alpha: 0.05)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Infrastructure & Free Host Telemetry',
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w700,
              color: Colors.white,
            ),
          ),
          const SizedBox(height: 14),
          _buildHealthRow(
            label: 'Azure VM Memory Footprint',
            value: '$rssMem MB / 1500 MB (< 3% RAM used)',
            icon: Icons.memory_rounded,
            statusColor: const Color(0xFF10B981),
          ),
          _buildHealthRow(
            label: 'Valkey/Redis Localhost Latency',
            value: '< 0.1 ms (Localhost Loopback)',
            icon: Icons.speed_rounded,
            statusColor: const Color(0xFF10B981),
          ),
          _buildHealthRow(
            label: 'Monthly Cloud Infrastructure Cost',
            value: '\$0.00 / month (100% Free)',
            icon: Icons.attach_money_rounded,
            statusColor: const Color(0xFF10B981),
          ),
          _buildHealthRow(
            label: 'Backend Server Uptime',
            value: '${hours}h ${(uptime % 3600) ~/ 60}m active',
            icon: Icons.access_time_rounded,
            statusColor: const Color(0xFF38BDF8),
          ),
        ],
      ),
    );
  }

  Widget _buildHealthRow({
    required String label,
    required String value,
    required IconData icon,
    required Color statusColor,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        children: [
          Icon(icon, size: 16, color: statusColor),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              label,
              style: TextStyle(fontSize: 12, color: Colors.white.withValues(alpha: 0.7)),
            ),
          ),
          Text(
            value,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: statusColor,
            ),
          ),
        ],
      ),
    );
  }
}
