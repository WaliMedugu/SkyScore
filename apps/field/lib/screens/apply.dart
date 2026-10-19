// New application: farmer (new or existing) → field → crop → read the satellites live.
import 'dart:async';

import 'package:flutter/material.dart';

import '../api.dart';
import '../theme.dart';
import '../widgets/science.dart';
import 'application.dart';
import 'field_map.dart';

class ApplyScreen extends StatefulWidget {
  const ApplyScreen({super.key, this.farmer});
  final Json? farmer;
  @override
  State<ApplyScreen> createState() => _ApplyScreenState();
}

class _ApplyScreenState extends State<ApplyScreen> {
  Json? _farmer;
  FieldResult? _field;
  String _crop = 'maize';
  String _tenure = 'family';
  bool _busy = false;
  List<Json> _crops = [];

  @override
  void initState() {
    super.initState();
    _farmer = widget.farmer;
    Api.getJson('/meta').then((m) => setState(() => _crops = (m['crops'] as List).cast<Json>())).catchError((_) {});
  }

  Future<void> _submit() async {
    setState(() => _busy = true);
    try {
      final farm = await Api.post('/farms', {
        'farmerId': _farmer!['id'],
        'polygon': _field!.toGeoJson(),
        'crop': _crop,
        'tenure': _tenure,
        'mapMethod': _field!.method,
      });
      final app = await Api.post('/applications', {'farmId': (farm['farm'] as Json)['id']});
      if (!mounted) return;
      Navigator.pushReplacement(
        context,
        MaterialPageRoute(builder: (_) => AnalysisScreen(jobId: app['jobId'] as String, applicationId: app['applicationId'] as String, place: _field!.place)),
      );
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('NEW APPLICATION')),
      body: ListView(children: [
        _step('01', 'Farmer', _farmer == null ? null : '${_farmer!['name']} · ${_farmer!['phone']}', () async {
          final f = await Navigator.push<Json>(context, MaterialPageRoute(builder: (_) => const FarmerPickScreen()));
          if (f != null) setState(() => _farmer = f);
        }),
        _step('02', 'Field', _field == null ? null : '${areaHa(_field!.points).toStringAsFixed(2)} ha · ${_field!.method == 'gps' ? 'GPS walk' : _field!.method == 'saved' ? _field!.place : 'tapped on the map'}', () async {
          final r = await Navigator.push<FieldResult>(context, MaterialPageRoute(builder: (_) => const FieldMapScreen()));
          if (r != null) setState(() => _field = r);
        }),
        SkBlock(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const SkLabel('03 · Crop and land', square: true),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _crop,
              decoration: const InputDecoration(labelText: 'CROP THIS SEASON'),
              items: [
                for (final c in (_crops.isEmpty ? [{'key': 'maize', 'label': 'Maize', 'hausa': 'Masara'}] : _crops))
                  DropdownMenuItem(value: c['key'] as String, child: Text('${c['label']} (${c['hausa']})')),
              ],
              onChanged: (v) => setState(() => _crop = v ?? _crop),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _tenure,
              decoration: const InputDecoration(labelText: 'LAND TENURE'),
              items: const [
                DropdownMenuItem(value: 'family', child: Text('Family land')),
                DropdownMenuItem(value: 'owned', child: Text('Owned')),
                DropdownMenuItem(value: 'leased', child: Text('Leased')),
                DropdownMenuItem(value: 'allocated', child: Text('Allocated (community / programme)')),
                DropdownMenuItem(value: 'rented', child: Text('Rented')),
              ],
              onChanged: (v) => setState(() => _tenure = v ?? _tenure),
            ),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.all(20),
          child: FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Sk.lime, foregroundColor: Sk.navy, minimumSize: const Size.fromHeight(60)),
            onPressed: _farmer != null && _field != null && !_busy ? _submit : null,
            child: Text(_busy ? 'SUBMITTING…' : 'READ THE FIELD FROM SPACE →'),
          ),
        ),
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 20),
          child: Text('SkyScore reads every satellite photo of this field since 2018, scores it, and sizes an input loan. A field already registered to someone else is refused.',
              style: TextStyle(color: Sk.faint, fontSize: 12)),
        ),
      ]),
    );
  }

  Widget _step(String n, String title, String? value, VoidCallback onTap) => InkWell(
        onTap: onTap,
        child: SkBlock(
          color: value != null ? Sk.limeSoft : Colors.white,
          child: Row(children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                SkLabel('$n · $title', square: true),
                const SizedBox(height: 8),
                Text(value ?? 'Tap to choose', style: TextStyle(fontSize: 17, color: value != null ? Sk.navy : Sk.faint, fontWeight: FontWeight.w500)),
              ]),
            ),
            Icon(value != null ? Icons.check : Icons.arrow_forward, color: Sk.navy),
          ]),
        ),
      );
}

/// Find an existing farmer or register a new one (with consent and BVN check).
class FarmerPickScreen extends StatefulWidget {
  const FarmerPickScreen({super.key});
  @override
  State<FarmerPickScreen> createState() => _FarmerPickScreenState();
}

class _FarmerPickScreenState extends State<FarmerPickScreen> {
  final _q = TextEditingController();
  Future<Json>? _results;
  bool _newFarmer = false;
  final _first = TextEditingController();
  final _last = TextEditingController();
  final _phone = TextEditingController();
  final _bvn = TextEditingController();
  final _born = TextEditingController(text: '2001');
  String _gender = 'female';
  String _hub = 'Zaria Youth Agripreneur Hub';
  bool _trained = true;
  bool _consent = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _results = Api.getJson('/farmers', {'limit': '30'});
  }

  Future<void> _register() async {
    setState(() => _busy = true);
    try {
      final r = await Api.post('/farmers', {
        'firstName': _first.text.trim(),
        'lastName': _last.text.trim(),
        'phone': _phone.text.trim(),
        'gender': _gender,
        if (int.tryParse(_born.text) != null) 'birthYear': int.parse(_born.text),
        if (_bvn.text.trim().isNotEmpty) 'bvn': _bvn.text.trim(),
        'hub': _hub,
        'trained': _trained,
        'consent': _consent,
      });
      if (!mounted) return;
      final bvn = r['bvn'] as Json?;
      if (bvn != null) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(bvn['message'] as String)));
      Navigator.pop(context, r['farmer'] as Json);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_newFarmer ? 'REGISTER FARMER' : 'CHOOSE FARMER'), actions: [
        TextButton(onPressed: () => setState(() => _newFarmer = !_newFarmer), child: Text(_newFarmer ? 'FIND EXISTING' : '+ NEW FARMER')),
      ]),
      body: _newFarmer ? _form() : _search(),
    );
  }

  Widget _search() => Column(children: [
        Padding(
          padding: const EdgeInsets.all(16),
          child: TextField(
            controller: _q,
            decoration: const InputDecoration(labelText: 'NAME OR PHONE', prefixIcon: Icon(Icons.search)),
            onSubmitted: (v) => setState(() => _results = Api.getJson('/farmers', {'q': v, 'limit': '30'})),
          ),
        ),
        const Divider(),
        Expanded(
          child: FutureBuilder<Json>(
            future: _results,
            builder: (context, snap) {
              if (snap.hasError) return Center(child: Text(errorText(snap.error!)));
              if (!snap.hasData) return const LinearProgressIndicator();
              final items = (snap.data!['items'] as List).cast<Json>();
              return ListView.separated(
                itemCount: items.length,
                separatorBuilder: (_, _) => const Divider(),
                itemBuilder: (_, i) => ListTile(
                  title: Text(items[i]['name'] as String),
                  subtitle: Text('${items[i]['phone']} · ${items[i]['hub'] ?? 'no hub'}'),
                  trailing: SkPill(items[i]['bvnVerified'] == true ? 'VERIFIED' : 'PENDING', text: items[i]['bvnVerified'] == true ? 'BVN ok' : 'no BVN'),
                  onTap: () => Navigator.pop(context, items[i]),
                ),
              );
            },
          ),
        ),
      ]);

  Widget _form() => ListView(padding: const EdgeInsets.all(16), children: [
        Row(children: [
          Expanded(child: TextField(controller: _first, decoration: const InputDecoration(labelText: 'FIRST NAME'))),
          const SizedBox(width: 8),
          Expanded(child: TextField(controller: _last, decoration: const InputDecoration(labelText: 'LAST NAME'))),
        ]),
        const SizedBox(height: 12),
        TextField(controller: _phone, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'PHONE', hintText: '0803 123 4567')),
        const SizedBox(height: 12),
        TextField(controller: _bvn, keyboardType: TextInputType.number, maxLength: 11, decoration: const InputDecoration(labelText: 'BVN (NEEDED TO BORROW)')),
        Row(children: [
          Expanded(
            child: DropdownButtonFormField<String>(
              initialValue: _gender,
              decoration: const InputDecoration(labelText: 'GENDER'),
              items: const [DropdownMenuItem(value: 'female', child: Text('Female')), DropdownMenuItem(value: 'male', child: Text('Male'))],
              onChanged: (v) => setState(() => _gender = v ?? _gender),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(child: TextField(controller: _born, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'YEAR OF BIRTH'))),
        ]),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(
          initialValue: _hub,
          decoration: const InputDecoration(labelText: 'TRAINING HUB'),
          items: const [
            DropdownMenuItem(value: 'Zaria Youth Agripreneur Hub', child: Text('Zaria Youth Agripreneur Hub')),
            DropdownMenuItem(value: 'Kachia Young Farmers Hub', child: Text('Kachia Young Farmers Hub')),
            DropdownMenuItem(value: 'Bida Rice Youth Hub', child: Text('Bida Rice Youth Hub')),
            DropdownMenuItem(value: 'Kuje Agripreneur Hub', child: Text('Kuje Agripreneur Hub')),
          ],
          onChanged: (v) => setState(() => _hub = v ?? _hub),
        ),
        CheckboxListTile(
          contentPadding: EdgeInsets.zero,
          value: _trained,
          onChanged: (v) => setState(() => _trained = v ?? false),
          title: const Text('Completed agripreneur training'),
          controlAffinity: ListTileControlAffinity.leading,
        ),
        Container(
          color: Sk.fog,
          child: CheckboxListTile(
            value: _consent,
            onChanged: (v) => setState(() => _consent = v ?? false),
            controlAffinity: ListTileControlAffinity.leading,
            title: const Text(
              'The farmer agrees that Ecobank may check their BVN, store their details and read satellite photos of the field they register, to assess and monitor an input loan (NDPA 2023).',
              style: TextStyle(fontSize: 13),
            ),
          ),
        ),
        const SizedBox(height: 16),
        FilledButton(onPressed: _consent && !_busy ? _register : null, child: Text(_busy ? 'REGISTERING…' : 'REGISTER FARMER →')),
      ]);
}

/// Live satellite read: photos counted as they come in, season verdicts as they firm up, then the score.
class AnalysisScreen extends StatefulWidget {
  const AnalysisScreen({super.key, required this.jobId, required this.applicationId, this.place});
  final String jobId;
  final String applicationId;
  final String? place;
  @override
  State<AnalysisScreen> createState() => _AnalysisScreenState();
}

class _AnalysisScreenState extends State<AnalysisScreen> {
  Timer? _t;
  Json? _job;
  String? _error;

  @override
  void initState() {
    super.initState();
    _poll();
    _t = Timer.periodic(const Duration(milliseconds: 450), (_) => _poll());
  }

  @override
  void dispose() {
    _t?.cancel();
    super.dispose();
  }

  Future<void> _poll() async {
    try {
      final job = await Api.getJson('/jobs/${widget.jobId}');
      if (!mounted) return;
      setState(() => _job = job);
      if (job['status'] == 'error') {
        _t?.cancel();
        setState(() => _error = job['error'] as String?);
      }
      if (job['status'] == 'done') {
        final app = await Api.getJson('/applications/${widget.applicationId}');
        if (app['status'] != 'ANALYZING' && mounted) {
          _t?.cancel();
          Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => ApplicationScreen(id: widget.applicationId)));
        }
      }
    } on ApiException catch (e) {
      if (e.status == 404) {
        // The job finished and was forgotten: go straight to the result.
        _t?.cancel();
        if (mounted) Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => ApplicationScreen(id: widget.applicationId)));
      }
    } catch (_) {
      // Keep polling through brief network hiccups.
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = _job?['progress'] as Json?;
    final partial = _job?['partial'] as Json?;
    final photos = (partial?['photos'] as num?)?.toInt() ?? (p?['stage'] == 'optical' ? (p?['done'] as num?)?.toInt() : null) ?? 0;
    return Scaffold(
      appBar: AppBar(title: const Text('READING FROM SPACE')),
      body: ListView(children: [
        SkBlock(
          color: Sk.navy,
          padding: const EdgeInsets.fromLTRB(20, 28, 20, 28),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SkLabel(widget.place ?? 'Your field', color: Sk.lime),
            const SizedBox(height: 18),
            TweenAnimationBuilder<double>(
              tween: Tween(begin: 0, end: photos.toDouble()),
              duration: const Duration(milliseconds: 400),
              builder: (_, v, _) => Text('${v.round()}', style: Sk.display(88, color: Colors.white)),
            ),
            Text('satellite photos read', style: TextStyle(color: Colors.white.withValues(alpha: 0.8), fontSize: 16)),
          ]),
        ),
        if (_error == null) const LinearProgressIndicator(minHeight: 3),
        SkBlock(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const SkLabel('Now', square: true),
            const SizedBox(height: 8),
            Text(_error ?? (p?['message'] as String?) ?? 'Searching the Sentinel-2 archive…', style: TextStyle(fontSize: 16, color: _error != null ? Sk.stress : Sk.navy)),
          ]),
        ),
        if (partial != null)
          SkBlock(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const SkLabel('Season by season, so far', square: true),
              const SizedBox(height: 12),
              SeasonChips(seasons: partial['seasons'] as List<dynamic>),
            ]),
          ),
        const Padding(
          padding: EdgeInsets.all(20),
          child: Text(
            'Sentinel-2 photographs every field in Nigeria every five days. SkyScore reads each photo of this field since 2018, adds Sentinel-1 radar through the clouds, land-cover maps and rainfall, and judges every rainy season.',
            style: TextStyle(color: Sk.muted),
          ),
        ),
      ]),
    );
  }
}
