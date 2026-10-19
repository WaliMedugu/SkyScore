// SkyScore design system for the field app: Ecobank palette on an Aspen-style grid.
// Square corners, 1px rules, big tight type, mono uppercase labels.
import 'package:flutter/material.dart';

class Sk {
  static const navy = Color(0xFF023448);
  static const deep = Color(0xFF005B82);
  static const sky = Color(0xFF0082BB);
  static const lime = Color(0xFFBED600);
  static const limeSoft = Color(0xFFEEF4C4);
  static const mist = Color(0xFFF7F7F7);
  static const fog = Color(0xFFECECEC);
  static const line = Color(0xFFD8D8D8);
  static const slate = Color(0xFF4E4E4E);
  static const muted = Color(0xFF3D5866);
  static const faint = Color(0xFF7A8D97);
  static const watch = Color(0xFFF5B400);
  static const stress = Color(0xFFE4572E);
  static const ghost = Color(0xFF9AA5AB);

  static const sans = 'Geist';
  static const mono = 'GeistMono';

  static const label = TextStyle(fontFamily: mono, fontSize: 11, fontWeight: FontWeight.w500, letterSpacing: 0.9, color: navy);
  static TextStyle display(double size, {Color color = navy}) =>
      TextStyle(fontFamily: sans, fontSize: size, fontWeight: FontWeight.w500, letterSpacing: -size * 0.04, height: 0.95, color: color);

  static Color tone(String? status) {
    switch (status) {
      case 'HEALTHY':
      case 'APPROVED':
      case 'APPROVE':
      case 'ACCEPTED':
      case 'ACTIVE':
      case 'T2_RELEASED':
      case 'ISSUED':
      case 'VERIFIED':
      case 'CULTIVATED':
        return const Color(0xFF5C6B00);
      case 'WATCH':
      case 'REVIEW':
      case 'PENDING':
      case 'UNCERTAIN':
      case 'HELD':
      case 'ANALYZING':
        return const Color(0xFFA87A00);
      case 'STRESS':
      case 'DECLINED':
      case 'DECLINE':
      case 'DEFAULTED':
      case 'T2_HELD':
      case 'ERROR':
        return stress;
      case 'FLOOD':
        return sky;
      case 'REPAID':
      case 'REDEEMED':
        return deep;
      default:
        return faint;
    }
  }

  static ThemeData theme() {
    final base = ThemeData(
      useMaterial3: true,
      fontFamily: sans,
      colorScheme: ColorScheme.fromSeed(seedColor: navy, primary: navy, secondary: lime, surface: Colors.white, onPrimary: Colors.white),
      scaffoldBackgroundColor: Colors.white,
    );
    const square = RoundedRectangleBorder(borderRadius: BorderRadius.zero);
    return base.copyWith(
      appBarTheme: const AppBarTheme(
        backgroundColor: Colors.white,
        foregroundColor: navy,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        shape: Border(bottom: BorderSide(color: line)),
        titleTextStyle: TextStyle(fontFamily: mono, fontSize: 12, fontWeight: FontWeight.w600, letterSpacing: 1.2, color: navy),
      ),
      dividerTheme: const DividerThemeData(color: line, thickness: 1, space: 1),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: navy,
          foregroundColor: Colors.white,
          shape: square,
          minimumSize: const Size(64, 52),
          textStyle: const TextStyle(fontFamily: mono, fontSize: 12, fontWeight: FontWeight.w600, letterSpacing: 1),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: navy,
          shape: square,
          side: const BorderSide(color: line),
          minimumSize: const Size(64, 48),
          textStyle: const TextStyle(fontFamily: mono, fontSize: 12, fontWeight: FontWeight.w600, letterSpacing: 1),
        ),
      ),
      textButtonTheme: TextButtonThemeData(style: TextButton.styleFrom(foregroundColor: navy, shape: square)),
      inputDecorationTheme: const InputDecorationTheme(
        border: OutlineInputBorder(borderRadius: BorderRadius.zero, borderSide: BorderSide(color: line)),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.zero, borderSide: BorderSide(color: line)),
        focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.zero, borderSide: BorderSide(color: navy, width: 1.5)),
        labelStyle: TextStyle(fontFamily: mono, fontSize: 12, letterSpacing: 0.8, color: muted),
        isDense: true,
      ),
      cardTheme: const CardThemeData(shape: square, elevation: 0, color: Colors.white, margin: EdgeInsets.zero),
      chipTheme: base.chipTheme.copyWith(shape: square),
      snackBarTheme: const SnackBarThemeData(
        backgroundColor: navy,
        behavior: SnackBarBehavior.floating,
        shape: Border(left: BorderSide(color: lime, width: 6)),
      ),
      dialogTheme: const DialogThemeData(shape: square, backgroundColor: Colors.white),
      bottomSheetTheme: const BottomSheetThemeData(shape: square, backgroundColor: Colors.white),
      progressIndicatorTheme: const ProgressIndicatorThemeData(color: lime, linearTrackColor: fog),
    );
  }
}

/// Mono uppercase label, optionally with Aspen's ■ marker.
class SkLabel extends StatelessWidget {
  const SkLabel(this.text, {super.key, this.square = false, this.color, this.size = 11});
  final String text;
  final bool square;
  final Color? color;
  final double size;
  @override
  Widget build(BuildContext context) => Text(
        '${square ? '■  ' : ''}${text.toUpperCase()}',
        style: Sk.label.copyWith(color: color ?? Sk.navy, fontSize: size),
      );
}

/// Outlined status pill with a square dot.
class SkPill extends StatelessWidget {
  const SkPill(this.status, {super.key, this.text});
  final String status;
  final String? text;
  @override
  Widget build(BuildContext context) {
    final c = Sk.tone(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(border: Border.all(color: c)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Container(width: 7, height: 7, color: c),
        const SizedBox(width: 6),
        Text((text ?? status.replaceAll('_', ' ')).toUpperCase(), style: Sk.label.copyWith(color: c, fontSize: 10.5, fontWeight: FontWeight.w600)),
      ]),
    );
  }
}

/// A full-width ruled section with optional colour block.
class SkBlock extends StatelessWidget {
  const SkBlock({super.key, required this.child, this.color = Colors.white, this.padding = const EdgeInsets.all(20)});
  final Widget child;
  final Color color;
  final EdgeInsets padding;
  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        decoration: BoxDecoration(color: color, border: const Border(bottom: BorderSide(color: Sk.line))),
        padding: padding,
        child: child,
      );
}

/// Big number with a mono caption (Aspen's stat tile).
class SkStat extends StatelessWidget {
  const SkStat({super.key, required this.value, required this.caption, this.color = Colors.white, this.fg = Sk.navy});
  final String value;
  final String caption;
  final Color color;
  final Color fg;
  @override
  Widget build(BuildContext context) => Container(
        color: color,
        padding: const EdgeInsets.fromLTRB(16, 18, 16, 16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerLeft, child: Text(value, style: Sk.display(40, color: fg))),
          const SizedBox(height: 18),
          Text(caption.toUpperCase(), style: Sk.label.copyWith(color: fg, fontSize: 10)),
        ]),
      );
}

String naira(num? v) {
  if (v == null) return '—';
  final s = v.round().toString();
  final b = StringBuffer();
  for (var i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 == 0) b.write(',');
    b.write(s[i]);
  }
  return '₦$b';
}

String shortDate(String? iso) {
  if (iso == null || iso.length < 10) return '—';
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  final d = DateTime.tryParse(iso.substring(0, 10));
  return d == null ? iso : '${d.day} ${m[d.month - 1]} ${d.year}';
}
