// The satellite story on a phone: score dial, season chips and an eight-year greenness chart.
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../api.dart';
import '../theme.dart';

const _bandColor = {'A': Sk.lime, 'B': Color(0xFF8FC31F), 'C': Sk.watch, 'D': Color(0xFFE98A2E), 'E': Sk.stress};

class ScoreDial extends StatelessWidget {
  const ScoreDial({super.key, required this.score, required this.band, required this.decision, this.ghost = false, this.size = 220});
  final int score;
  final String band;
  final String decision;
  final bool ghost;
  final double size;

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: score.toDouble()),
      duration: const Duration(milliseconds: 1100),
      curve: Curves.easeOutCubic,
      builder: (context, v, _) => SizedBox(
        width: size,
        height: size,
        child: CustomPaint(
          painter: _DialPainter(v / 100, ghost ? Sk.ghost : (_bandColor[band] ?? Sk.lime)),
          child: Center(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              const SkLabel('SkyScore', color: Sk.faint),
              Text('${v.round()}', style: Sk.display(size * 0.36)),
              const SizedBox(height: 6),
              SkLabel(ghost ? 'Ghost farm' : 'Band $band · $decision'),
            ]),
          ),
        ),
      ),
    );
  }
}

class _DialPainter extends CustomPainter {
  _DialPainter(this.f, this.color);
  final double f;
  final Color color;
  @override
  void paint(Canvas canvas, Size s) {
    final r = Rect.fromLTWH(8, 8, s.width - 16, s.height - 16);
    final bg = Paint()
      ..color = Sk.fog
      ..style = PaintingStyle.stroke
      ..strokeWidth = 10;
    final fg = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 10;
    canvas.drawArc(r, 0, math.pi * 2, false, bg);
    canvas.drawArc(r, -math.pi / 2, math.pi * 2 * f.clamp(0, 1), false, fg);
  }

  @override
  bool shouldRepaint(_DialPainter o) => o.f != f || o.color != color;
}

const _labelText = {'CULTIVATED': 'Farmed', 'UNCERTAIN': 'Unclear', 'NOT_CULTIVATED': 'Not farmed', 'NO_DATA': 'No data'};

/// One block per rainy season: lime = farmed, hatched = unclear, grey = not farmed.
class SeasonChips extends StatelessWidget {
  const SeasonChips({super.key, required this.seasons});
  final List<dynamic> seasons;
  @override
  Widget build(BuildContext context) {
    if (seasons.isEmpty) return const SizedBox.shrink();
    return Container(
      decoration: BoxDecoration(border: Border.all(color: Sk.line)),
      child: Row(
        children: [
          for (final s in seasons.cast<Json>())
            Expanded(
              child: Container(
                padding: const EdgeInsets.fromLTRB(4, 8, 4, 6),
                decoration: const BoxDecoration(border: Border(right: BorderSide(color: Sk.line))),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text("'${'${s['year']}'.substring(2)}", style: Sk.label.copyWith(fontSize: 10)),
                  const SizedBox(height: 4),
                  Container(
                    height: 22,
                    decoration: BoxDecoration(
                      color: switch (s['label']) {
                        'CULTIVATED' => Sk.lime,
                        'UNCERTAIN' => Sk.limeSoft,
                        'NOT_CULTIVATED' => Sk.fog,
                        _ => Colors.white,
                      }
                          .withValues(alpha: s['complete'] == false ? 0.55 : 1),
                      border: s['label'] == 'NO_DATA' ? Border.all(color: Sk.faint) : null,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(_labelText[s['label']] ?? '', style: Sk.label.copyWith(fontSize: 8.5, color: Sk.muted), maxLines: 1, overflow: TextOverflow.clip),
                ]),
              ),
            ),
        ],
      ),
    );
  }
}

/// Greenness over the years; the dots draw in one by one, the way the satellites delivered them.
class NdviChart extends StatefulWidget {
  const NdviChart({super.key, required this.points, required this.seasons, this.height = 200});
  final List<dynamic> points;
  final List<dynamic> seasons;
  final double height;
  @override
  State<NdviChart> createState() => _NdviChartState();
}

class _NdviChartState extends State<NdviChart> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 2200))..forward();
  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: widget.height,
      width: double.infinity,
      child: AnimatedBuilder(
        animation: _c,
        builder: (_, _) => CustomPaint(painter: _NdviPainter(widget.points.cast<Json>(), widget.seasons.cast<Json>(), Curves.easeOut.transform(_c.value))),
      ),
    );
  }
}

class _NdviPainter extends CustomPainter {
  _NdviPainter(List<Json> pts, this.seasons, this.t) : pts = ([...pts]..sort((a, b) => (a['date'] as String).compareTo(b['date'] as String)));
  final List<Json> pts;
  final List<Json> seasons;
  final double t;

  @override
  void paint(Canvas canvas, Size s) {
    if (pts.isEmpty) return;
    const l = 30.0, r = 6.0, top = 8.0, b = 20.0;
    final t0 = DateTime.parse(pts.first['date'] as String).millisecondsSinceEpoch.toDouble();
    final t1 = math.max(t0 + 1, DateTime.parse(pts.last['date'] as String).millisecondsSinceEpoch.toDouble());
    double x(String d) => l + (DateTime.parse(d).millisecondsSinceEpoch - t0) / (t1 - t0) * (s.width - l - r);
    double y(num v) => top + (1 - ((v.toDouble() + 0.1) / 1.05).clamp(0, 1)) * (s.height - top - b);
    final grid = Paint()
      ..color = Sk.line
      ..strokeWidth = 1;
    final tp = TextPainter(textDirection: TextDirection.ltr);
    for (final v in [0.0, 0.25, 0.5, 0.75]) {
      canvas.drawLine(Offset(l, y(v)), Offset(s.width - r, y(v)), grid);
      tp.text = TextSpan(text: v.toStringAsFixed(2), style: Sk.label.copyWith(fontSize: 8, color: Sk.faint));
      tp.layout();
      tp.paint(canvas, Offset(0, y(v) - 5));
    }
    final first = DateTime.parse(pts.first['date'] as String).year;
    final last = DateTime.parse(pts.last['date'] as String).year;
    final byYear = {for (final se in seasons) se['year'] as int: se['label'] as String};
    for (var yr = first; yr <= last; yr++) {
      final a = math.max(l, x('$yr-06-01'));
      final z = math.min(s.width - r, x('$yr-10-31'));
      if (z <= a) continue;
      final lab = byYear[yr];
      canvas.drawRect(
        Rect.fromLTRB(a, top, z, s.height - b),
        Paint()..color = (lab == 'CULTIVATED' ? Sk.lime : lab == 'UNCERTAIN' ? Sk.watch : Sk.fog).withValues(alpha: lab == 'CULTIVATED' ? 0.25 : 0.18),
      );
      tp.text = TextSpan(text: '$yr', style: Sk.label.copyWith(fontSize: 8, color: Sk.faint));
      tp.layout();
      tp.paint(canvas, Offset(x('$yr-07-01') - tp.width / 2, s.height - b + 5));
    }
    final shown = (pts.length * t).ceil();
    final clear = pts.take(shown).where((p) => p['clear'] == true).toList();
    final path = Path();
    for (var i = 0; i < clear.length; i++) {
      final o = Offset(x(clear[i]['date'] as String), y(clear[i]['ndvi'] as num));
      i == 0 ? path.moveTo(o.dx, o.dy) : path.lineTo(o.dx, o.dy);
    }
    canvas.drawPath(
      path,
      Paint()
        ..color = Sk.navy
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.3,
    );
    final dot = Paint()..color = Sk.navy;
    final hollow = Paint()
      ..color = Sk.faint
      ..style = PaintingStyle.stroke
      ..strokeWidth = 0.8;
    for (final p in pts.take(shown)) {
      final o = Offset(x(p['date'] as String), y(math.max(-0.1, (p['ndvi'] as num).toDouble())));
      p['clear'] == true ? canvas.drawCircle(o, 2.4, dot) : canvas.drawCircle(o, 1.5, hollow);
    }
  }

  @override
  bool shouldRepaint(_NdviPainter o) => o.t != t || o.pts.length != pts.length;
}
