// The verdict and the offer; the farmer's SMS consent; then the loan with its vouchers.
import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../api.dart';
import '../theme.dart';
import '../widgets/science.dart';

class ApplicationScreen extends StatefulWidget {
  const ApplicationScreen({super.key, required this.id});
  final String id;
  @override
  State<ApplicationScreen> createState() => _ApplicationScreenState();
}

class _ApplicationScreenState extends State<ApplicationScreen> {
  late Future<Json> _app = Api.getJson('/applications/${widget.id}');
  Future<Json>? _analysis;
  bool _busy = false;

  void _reload() => setState(() => _app = Api.getJson('/applications/${widget.id}'));

  Future<void> _consent(Json app) async {
    setState(() => _busy = true);
    try {
      final r = await Api.post('/applications/${app['id']}/otp');
      if (!mounted) return;
      final code = TextEditingController();
      final otp = await showDialog<String>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const SkLabel('Farmer consent', square: true),
          content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('A 6-digit code was sent to ${r['to']}. Ask the farmer to read it to you.'),
            if (r['sandboxOtp'] != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text('Sandbox code: ${r['sandboxOtp']}', style: Sk.label.copyWith(color: Sk.faint))),
            const SizedBox(height: 16),
            TextField(
              controller: code,
              autofocus: true,
              keyboardType: TextInputType.number,
              maxLength: 6,
              style: Sk.display(28),
              decoration: const InputDecoration(hintText: '000000', counterText: ''),
            ),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('CANCEL')),
            FilledButton(onPressed: () => Navigator.pop(ctx, code.text.trim()), child: const Text('ACCEPT OFFER →')),
          ],
        ),
      );
      if (otp == null || otp.isEmpty) return;
      final loan = await Api.post('/applications/${app['id']}/accept', {'otp': otp});
      if (!mounted) return;
      Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => LoanScreen(id: loan['id'] as String)));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('APPLICATION'), actions: [IconButton(onPressed: _reload, icon: const Icon(Icons.refresh))]),
      body: FutureBuilder<Json>(
        future: _app,
        builder: (context, snap) {
          if (snap.hasError) return Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(errorText(snap.error!))));
          if (!snap.hasData) return const LinearProgressIndicator();
          final app = snap.data!;
          final farm = app['farm'] as Json?;
          _analysis ??= farm != null ? Api.getJson('/farms/${farm['id']}/analysis') : null;
          final assessment = app['assessment'] as Json?;
          final score = assessment?['score'] as Json?;
          final offer = app['offer'] as Json?;
          final status = app['status'] as String;
          return ListView(children: [
            SkBlock(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [Expanded(child: SkLabel('${app['seasonYear']} season · ${farm?['cropLabel'] ?? ''}', square: true)), SkPill(status)]),
                const SizedBox(height: 10),
                Text('${(app['farmer'] as Json?)?['name'] ?? ''}', style: Sk.display(32)),
                Text('${farm?['name'] ?? ''} · ${(farm?['areaHa'] as num?)?.toStringAsFixed(2) ?? ''} ha', style: const TextStyle(color: Sk.muted)),
              ]),
            ),
            if (score != null)
              SkBlock(
                child: Column(children: [
                  ScoreDial(score: (score['score'] as num).toInt(), band: score['band'] as String, decision: score['decision'] as String, ghost: score['ghost'] == true),
                  const SizedBox(height: 12),
                  Text(score['headline'] as String, textAlign: TextAlign.center, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w500)),
                ]),
              ),
            if (assessment != null)
              SkBlock(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const SkLabel('Season by season', square: true),
                  const SizedBox(height: 10),
                  SeasonChips(seasons: assessment['seasons'] as List<dynamic>),
                  const SizedBox(height: 14),
                  FutureBuilder<Json>(
                    future: _analysis,
                    builder: (context, a) => a.hasData && a.data!['ready'] == true
                        ? NdviChart(points: (a.data!['series'] as Json)['optical'] as List<dynamic>, seasons: assessment['seasons'] as List<dynamic>)
                        : const SizedBox(height: 40),
                  ),
                ]),
              ),
            if (score != null && (score['concerns'] as List).isNotEmpty)
              SkBlock(
                color: Sk.mist,
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const SkLabel('Concerns', square: true),
                  const SizedBox(height: 8),
                  for (final c in (score['concerns'] as List).cast<String>()) Padding(padding: const EdgeInsets.only(bottom: 6), child: Text('• $c')),
                ]),
              ),
            if (offer != null && offer['eligible'] == true)
              SkBlock(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const SkLabel('The offer', square: true),
                  const SizedBox(height: 8),
                  Text(naira(offer['principal'] as num), style: Sk.display(40)),
                  const SizedBox(height: 10),
                  for (final i in (offer['items'] as List).cast<Json>())
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Row(children: [
                        Expanded(child: Text('${i['qty']} × ${i['name']}\n${i['unit']} · tranche ${i['tranche']}', style: const TextStyle(height: 1.3))),
                        Text(naira(i['amount'] as num)),
                      ]),
                    ),
                  const Divider(),
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Row(children: [
                      Expanded(child: Text('Repay after harvest, by ${shortDate(offer['dueDate'] as String?)}', style: const TextStyle(fontWeight: FontWeight.w600))),
                      Text(naira(offer['totalRepayable'] as num), style: const TextStyle(fontWeight: FontWeight.w600)),
                    ]),
                  ),
                  const SizedBox(height: 6),
                  const Text('Tranche 2 is released when the satellites see the crop come up.', style: TextStyle(color: Sk.muted, fontSize: 13)),
                ]),
              ),
            Padding(
              padding: const EdgeInsets.all(20),
              child: switch (status) {
                'APPROVED' => FilledButton(
                    style: FilledButton.styleFrom(backgroundColor: Sk.lime, foregroundColor: Sk.navy, minimumSize: const Size.fromHeight(60)),
                    onPressed: _busy ? null : () => _consent(app),
                    child: const Text('GET THE FARMER\'S CONSENT →'),
                  ),
                'ACCEPTED' => FilledButton(
                    onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => LoanScreen(id: app['loanId'] as String))),
                    child: const Text('OPEN THE LOAN →'),
                  ),
                'REVIEW' => const Text('A loan officer is reviewing this application. The farmer will get an SMS when it is decided.', style: TextStyle(color: Sk.muted)),
                'DECLINED' => Text(
                    app['ghost'] == true
                        ? 'No farming history was found on this land. Map the field the farmer actually farms.'
                        : 'Not approved this season. ${app['officerNote'] ?? 'The farmer can apply again next season with more history.'}',
                    style: const TextStyle(color: Sk.stress),
                  ),
                _ => OutlinedButton(onPressed: _reload, child: const Text('REFRESH')),
              },
            ),
          ]);
        },
      ),
    );
  }
}

class LoanScreen extends StatefulWidget {
  const LoanScreen({super.key, required this.id});
  final String id;
  @override
  State<LoanScreen> createState() => _LoanScreenState();
}

class _LoanScreenState extends State<LoanScreen> {
  late Future<Json> _loan = Api.getJson('/loans/${widget.id}');
  bool _busy = false;

  Future<void> _check() async {
    setState(() => _busy = true);
    try {
      await Api.post('/loans/${widget.id}/monitor', {});
      setState(() => _loan = Api.getJson('/loans/${widget.id}'));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('LOAN')),
      body: FutureBuilder<Json>(
        future: _loan,
        builder: (context, snap) {
          if (snap.hasError) return Center(child: Text(errorText(snap.error!)));
          if (!snap.hasData) return const LinearProgressIndicator();
          final l = snap.data!;
          final m = l['monitor'] as Json?;
          return ListView(children: [
            SkBlock(
              color: Sk.navy,
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [Expanded(child: SkLabel('${l['cropLabel']} · ${l['seasonYear']}', color: Sk.lime)), SkPill(l['state'] as String)]),
                const SizedBox(height: 14),
                Text('${(l['farmer'] as Json?)?['name'] ?? ''}', style: Sk.display(30, color: Colors.white)),
                const SizedBox(height: 12),
                Text(m?['summary'] as String? ?? 'Not checked from space yet.', style: TextStyle(color: Colors.white.withValues(alpha: 0.85), fontSize: 15)),
              ]),
            ),
            Row(children: [
              Expanded(child: SkStat(value: naira(l['outstanding'] as num), caption: 'Owed now', color: Sk.lime)),
              Expanded(child: SkStat(value: naira(l['principal'] as num), caption: 'Inputs approved', color: Sk.fog)),
            ]),
            for (final v in (l['vouchers'] as List).cast<Json>()) _voucher(v),
            Padding(
              padding: const EdgeInsets.all(20),
              child: OutlinedButton.icon(onPressed: _busy ? null : _check, icon: const Icon(Icons.satellite_alt), label: const Text('CHECK THE CROP FROM SPACE')),
            ),
          ]);
        },
      ),
    );
  }

  Widget _voucher(Json v) {
    final status = v['status'] as String;
    return SkBlock(
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Opacity(
          opacity: status == 'ISSUED' ? 1 : 0.3,
          child: QrImageView(data: v['code'] as String, size: 120, backgroundColor: Colors.white, padding: EdgeInsets.zero),
        ),
        const SizedBox(width: 16),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [Expanded(child: SkLabel('Tranche ${v['tranche']}', square: true)), SkPill(status, text: status == 'HELD' ? 'held' : null)]),
            const SizedBox(height: 8),
            Text(v['code'] as String, style: const TextStyle(fontFamily: Sk.mono, fontSize: 18, letterSpacing: 1)),
            Text(naira(v['amount'] as num), style: Sk.display(24)),
            const SizedBox(height: 6),
            for (final i in (v['items'] as List).cast<Json>()) Text('${i['qty']} × ${i['name']}', style: const TextStyle(fontSize: 13)),
            const SizedBox(height: 6),
            Text(
              status == 'REDEEMED'
                  ? 'Handed over at ${v['dealerName']}'
                  : status == 'HELD'
                      ? 'Released when the crop greens up'
                      : 'Show this code at any SkyScore agro-dealer',
              style: Sk.label.copyWith(color: Sk.faint, fontSize: 10),
            ),
          ]),
        ),
      ]),
    );
  }
}
