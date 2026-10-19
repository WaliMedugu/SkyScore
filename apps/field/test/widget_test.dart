import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:skyscore_field/api.dart';
import 'package:skyscore_field/main.dart';
import 'package:skyscore_field/screens/field_map.dart';
import 'package:skyscore_field/theme.dart';

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('opens on the sign-in screen when signed out', (tester) async {
    await Session.instance.load();
    await tester.pumpWidget(const SkyScoreApp());
    expect(find.text('SkyScore'), findsOneWidget);
    expect(find.text('SIGN IN →'), findsOneWidget);
  });

  test('measures a field in hectares', () {
    // ~100 m × ~100 m near Zaria ≈ 1 ha.
    final pts = [const LatLng(11.0494, 7.6194), const LatLng(11.0494, 7.62032), const LatLng(11.05030, 7.62032), const LatLng(11.05030, 7.6194)];
    expect(areaHa(pts), closeTo(1.0, 0.05));
  });

  test('turns a mapped field into a closed GeoJSON polygon', () {
    final f = FieldResult([const LatLng(11, 7), const LatLng(11, 7.001), const LatLng(11.001, 7.001)], 'tap');
    final ring = (f.toGeoJson()['coordinates'] as List).first as List;
    expect(ring.first, ring.last);
    expect(ring.length, 4);
  });

  test('formats naira with thousands separators', () {
    expect(naira(1234567), '₦1,234,567');
    expect(naira(950), '₦950');
  });

  testWidgets('pills colour statuses by meaning', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: SkPill('APPROVED'))));
    expect(find.text('APPROVED'), findsOneWidget);
    expect(Sk.tone('STRESS'), Sk.stress);
  });
}
