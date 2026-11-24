class AlgoTraceStep {
  final int stepIndex;
  final String title;
  final String detail;
  final int pseudocodeLine;
  final Map<String, dynamic> stateSnapshot;

  const AlgoTraceStep({
    required this.stepIndex,
    required this.title,
    required this.detail,
    required this.pseudocodeLine,
    this.stateSnapshot = const {},
  });
}
