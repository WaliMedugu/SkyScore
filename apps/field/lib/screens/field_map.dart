// Map the field: walk the boundary with GPS, tap its corners on the satellite photo, or pick a saved real field.
import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';

import '../api.dart';
import '../theme.dart';

class FieldResult {
  FieldResult(this.points, this.method, {this.snapKey, this.place});
  final List<LatLng> points;
  final String method; // gps | tap | saved
  final String? snapKey;
  final String? place;

  Json toGeoJson() {
    final ring = [for (final p in points) [_r(p.longitude), _r(p.latitude)]];
    ring.add(ring.first);
    return {'type': 'Polygon', 'coordinates': [ring]};
  }

  static double _r(double v) => (v * 1e7).round() / 1e7;
}

/// Field area in hectares (local equirectangular projection; accurate for farm-sized shapes).
double areaHa(List<LatLng> pts) {
  if (pts.length < 3) return 0;
  final lat0 = pts.map((p) => p.latitude).reduce((a, b) => a + b) / pts.length;
  final kx = 111320 * math.cos(lat0 * math.pi / 180);
  const ky = 110540.0;
  var sum = 0.0;
  for (var i = 0; i < pts.length; i++) {
    final a = pts[i], b = pts[(i + 1) % pts.length];
    sum += (a.longitude * kx) * (b.latitude * ky) - (b.longitude * kx) * (a.latitude * ky);
  }
  return sum.abs() / 2 / 10000;
}

enum MapMode { tap, gps }

class FieldMapScreen extends StatefulWidget {
  const FieldMapScreen({super.key});
  @override
  State<FieldMapScreen> createState() => _FieldMapScreenState();
}

class _FieldMapScreenState extends State<FieldMapScreen> {
  final _map = MapController();
  final List<LatLng> _pts = [];
  MapMode _mode = MapMode.tap;
  StreamSubscription<Position>? _gps;
  Position? _here;
  String? _snapKey;
  String? _place;
  String? _gpsError;

  @override
  void dispose() {
    _gps?.cancel();
    super.dispose();
  }

  double get _ha => areaHa(_pts);
  String? get _problem {
    if (_pts.length < 3) return null;
    if (_ha < 0.05) return 'Too small: a field needs at least 0.05 ha.';
    if (_ha > 50) return 'Too big: SkyScore lends on fields up to 50 ha.';
    return null;
  }

  Future<void> _startGps() async {
    setState(() {
      _gpsError = null;
      _mode = MapMode.gps;
      _pts.clear();
      _snapKey = null;
    });
    try {
      if (!await Geolocator.isLocationServiceEnabled()) throw 'Turn on location (GPS) on this phone.';
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
      if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) throw 'SkyScore needs location permission to walk the boundary.';
      _gps = Geolocator.getPositionStream(locationSettings: const LocationSettings(accuracy: LocationAccuracy.best, distanceFilter: 4)).listen((p) {
        final ll = LatLng(p.latitude, p.longitude);
        setState(() {
          _here = p;
          if (p.accuracy <= 15) _pts.add(ll);
        });
        _map.move(ll, math.max(_map.camera.zoom, 17));
      }, onError: (Object e) => setState(() => _gpsError = '$e'));
    } catch (e) {
      setState(() {
        _gpsError = '$e';
        _mode = MapMode.tap;
      });
    }
  }

  void _stopGps() {
    _gps?.cancel();
    _gps = null;
    setState(() => _mode = MapMode.tap);
  }

  Future<void> _pickSaved() async {
    final fields = await Api.getList('/showcase').catchError((Object e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(e))));
      return <dynamic>[];
    });
    if (!mounted || fields.isEmpty) return;
    final picked = await showModalBottomSheet<Json>(
      context: context,
      builder: (ctx) => ListView(
        shrinkWrap: true,
        children: [
          const Padding(padding: EdgeInsets.all(16), child: SkLabel('Saved real fields (venue demo)', square: true)),
          for (final f in fields.cast<Json>())
            ListTile(
              title: Text(f['place'] as String),
              subtitle: Text('${f['kind'] == 'control' ? 'Not a farm' : f['cropLabel']} · ${(f['areaHa'] as num).toStringAsFixed(2)} ha', style: Sk.label.copyWith(color: Sk.faint)),
              trailing: const Icon(Icons.arrow_forward),
              onTap: () => Navigator.pop(ctx, f),
            ),
        ],
      ),
    );
    if (picked == null) return;
    final ring = ((picked['polygon'] as Json)['coordinates'] as List).first as List;
    final pts = [for (final c in ring.take(ring.length - 1)) LatLng((c[1] as num).toDouble(), (c[0] as num).toDouble())];
    setState(() {
      _pts
        ..clear()
        ..addAll(pts);
      _snapKey = picked['key'] as String;
      _place = picked['place'] as String;
      _mode = MapMode.tap;
    });
    _map.fitCamera(CameraFit.coordinates(coordinates: pts, padding: const EdgeInsets.all(60), maxZoom: 17));
  }

  @override
  Widget build(BuildContext context) {
    final ok = _pts.length >= 3 && _problem == null;
    return Scaffold(
      appBar: AppBar(title: const Text('MAP THE FIELD'), actions: [
        TextButton(onPressed: _pickSaved, child: const Text('SAVED FIELDS')),
      ]),
      body: Column(children: [
        Expanded(
          child: Stack(children: [
            FlutterMap(
              mapController: _map,
              options: MapOptions(
                initialCenter: const LatLng(10.2, 7.6),
                initialZoom: 7,
                onTap: (_, ll) {
                  if (_mode != MapMode.tap) return;
                  setState(() {
                    _pts.add(ll);
                    _snapKey = null;
                  });
                },
              ),
              children: [
                TileLayer(
                  urlTemplate: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
                  userAgentPackageName: 'ng.skyscore.field',
                  maxNativeZoom: 18,
                ),
                if (_pts.length >= 3)
                  PolygonLayer(polygons: [
                    Polygon(points: _pts, color: Sk.lime.withValues(alpha: 0.25), borderColor: Sk.lime, borderStrokeWidth: 3),
                  ]),
                if (_pts.length == 2) PolylineLayer(polylines: [Polyline(points: _pts, color: Sk.lime, strokeWidth: 3)]),
                MarkerLayer(markers: [
                  for (final p in _pts)
                    Marker(
                      point: p,
                      width: 14,
                      height: 14,
                      child: Container(decoration: BoxDecoration(color: Sk.lime, border: Border.all(color: Sk.navy, width: 2))),
                    ),
                  if (_here != null)
                    Marker(
                      point: LatLng(_here!.latitude, _here!.longitude),
                      width: 22,
                      height: 22,
                      child: Container(decoration: BoxDecoration(color: Sk.sky, shape: BoxShape.circle, border: Border.all(color: Colors.white, width: 3))),
                    ),
                ]),
                const RichAttributionWidget(attributions: [TextSourceAttribution('Imagery © Esri, Maxar, Earthstar Geographics')]),
              ],
            ),
            Positioned(
              left: 12,
              right: 12,
              top: 12,
              child: Container(
                color: Colors.white,
                padding: const EdgeInsets.all(12),
                child: Text(
                  _mode == MapMode.gps
                      ? 'Walk slowly around the edge of the field. Points are added every few metres (GPS ±${_here?.accuracy.round() ?? '–'} m).'
                      : _snapKey != null
                          ? 'Saved real field: $_place.'
                          : 'Zoom in on the field and tap each corner on the photo, or walk the boundary with GPS.',
                  style: const TextStyle(fontSize: 13),
                ),
              ),
            ),
          ]),
        ),
        Container(
          decoration: const BoxDecoration(border: Border(top: BorderSide(color: Sk.line))),
          padding: const EdgeInsets.all(12),
          child: SafeArea(
            top: false,
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Row(children: [
                Expanded(
                  child: Text(
                    _pts.length < 3 ? '${_pts.length} corner${_pts.length == 1 ? '' : 's'} so far' : (_problem ?? '${_ha.toStringAsFixed(2)} hectares · ${_pts.length} corners'),
                    style: TextStyle(color: _problem != null ? Sk.stress : Sk.navy, fontWeight: FontWeight.w500),
                  ),
                ),
                IconButton(tooltip: 'Undo', onPressed: _pts.isEmpty ? null : () => setState(() => _pts.removeLast()), icon: const Icon(Icons.undo)),
                IconButton(tooltip: 'Clear', onPressed: _pts.isEmpty ? null : () => setState(() => _pts.clear()), icon: const Icon(Icons.delete_outline)),
              ]),
              if (_gpsError != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(_gpsError!, style: const TextStyle(color: Sk.stress))),
              Row(children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _mode == MapMode.gps ? _stopGps : _startGps,
                    icon: Icon(_mode == MapMode.gps ? Icons.stop : Icons.directions_walk),
                    label: Text(_mode == MapMode.gps ? 'STOP WALK' : 'WALK WITH GPS'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: FilledButton(
                    style: FilledButton.styleFrom(backgroundColor: Sk.lime, foregroundColor: Sk.navy),
                    onPressed: ok
                        ? () {
                            _gps?.cancel();
                            Navigator.pop(context, FieldResult(List.of(_pts), _snapKey != null ? 'saved' : (_mode == MapMode.gps || _here != null ? 'gps' : 'tap'), snapKey: _snapKey, place: _place));
                          }
                        : null,
                    child: const Text('USE THIS FIELD →'),
                  ),
                ),
              ]),
            ]),
          ),
        ),
      ]),
    );
  }
}
