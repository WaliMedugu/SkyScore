// Agro-dealer counter: scan the farmer's voucher (or type it), hand over the inputs, get paid.
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../api.dart';
import '../theme.dart';

/// Phones and the browser have a camera scanner; desktop builds use typed codes.
bool get canScan => kIsWeb || defaultTargetPlatform == TargetPlatform.android || defaultTargetPlatform == TargetPlatform.iOS;

final _codeRe = RegExp(r'SKY-?([A-Z0-9]{4})-?([A-Z0-9]{4})', caseSensitive: false);

class ScanScreen extends StatefulWidget {
  const ScanScreen({super.key});
  @override
  State<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends State<ScanScreen> {
  final _code = TextEditingController(text: 'SKY-');
  Json? _voucher;
  Json? _paid;
  bool _busy = false;
  bool _scanning = canScan;

  Future<void> _lookup(String raw) async {
    final m = _codeRe.firstMatch(raw.toUpperCase());
    if (m == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('That is not a SkyScore voucher code (SKY-XXXX-XXXX).')));
      return;
    }
    final code = 'SKY-${m.group(1)}-${m.group(2)}';
    setState(() {
      _busy = true;
      _scanning = false;
      _paid = null;
      _code.text = code;
    });
    try {
      final v = await Api.getJson('/vouchers/$code');
      setState(() => _voucher = v);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _redeem() async {
    setState(() => _busy = true);
    try {
      final r = await Api.post('/vouchers/${_voucher!['code']}/redeem', {});
      setState(() {
        _paid = r;
        _voucher = r['voucher'] as Json;
      });
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final dealer = Session.instance.isDealer;
    return Scaffold(
      appBar: AppBar(title: Text(dealer ? 'REDEEM VOUCHER' : 'CHECK VOUCHER')),
      body: ListView(children: [
        if (_scanning)
          SizedBox(
            height: 320,
            child: MobileScanner(
              onDetect: (capture) {
                final raw = capture.barcodes.map((b) => b.rawValue ?? '').firstWhere((v) => _codeRe.hasMatch(v.toUpperCase()), orElse: () => '');
                if (raw.isNotEmpty && !_busy) _lookup(raw);
              },
              errorBuilder: (context, error) => Container(
                color: Sk.fog,
                alignment: Alignment.center,
                padding: const EdgeInsets.all(20),
                child: const Text('Camera not available. Type the code below.', textAlign: TextAlign.center),
              ),
            ),
          ),
        Padding(
          padding: const EdgeInsets.all(16),
          child: Row(children: [
            Expanded(
              child: TextField(
                controller: _code,
                textCapitalization: TextCapitalization.characters,
                style: const TextStyle(fontFamily: Sk.mono, fontSize: 20, letterSpacing: 1.5),
                decoration: const InputDecoration(labelText: 'VOUCHER CODE'),
                onSubmitted: _lookup,
              ),
            ),
            const SizedBox(width: 8),
            FilledButton(onPressed: _busy ? null : () => _lookup(_code.text), child: const Text('LOOK UP')),
          ]),
        ),
        if (canScan && !_scanning)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: OutlinedButton.icon(onPressed: () => setState(() => _scanning = true), icon: const Icon(Icons.qr_code_scanner), label: const Text('SCAN ANOTHER')),
          ),
        if (_voucher != null) _card(_voucher!, dealer),
      ]),
    );
  }

  Widget _card(Json v, bool dealer) {
    final status = v['status'] as String;
    return Container(
      margin: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: _paid != null ? Sk.lime : Colors.white, border: Border.all(color: Sk.line)),
      padding: const EdgeInsets.all(18),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text(v['code'] as String, style: const TextStyle(fontFamily: Sk.mono, fontSize: 18, letterSpacing: 1))),
          SkPill(status),
        ]),
        const SizedBox(height: 8),
        Text('${v['farmerName']} · ${v['farmerPhoneMasked']} · ${v['crop']} · tranche ${v['tranche']}', style: const TextStyle(fontSize: 15)),
        const SizedBox(height: 12),
        for (final i in (v['items'] as List).cast<Json>())
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 5),
            child: Row(children: [
              Text('${i['qty']} ×', style: Sk.display(22)),
              const SizedBox(width: 12),
              Expanded(child: Text('${i['name']}\n${i['unit']}', style: const TextStyle(height: 1.25))),
              Text(naira(i['amount'] as num)),
            ]),
          ),
        const SizedBox(height: 12),
        if (_paid != null) ...[
          Text('${naira(_paid!['amount'] as num)} paid', style: Sk.display(34)),
          Text('Settled to account ${_paid!['settledTo']}. The farmer has an SMS receipt.', style: const TextStyle(fontSize: 13)),
        ] else if (status == 'ISSUED' && dealer)
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Sk.lime, foregroundColor: Sk.navy, minimumSize: const Size.fromHeight(58)),
            onPressed: _busy ? null : _redeem,
            child: Text('INPUTS HANDED OVER · PAY ${naira(v['amount'] as num)}'),
          )
        else
          Text(
            status == 'REDEEMED'
                ? 'Already redeemed at ${v['dealerName']}.'
                : status == 'HELD'
                    ? 'On hold until the satellites confirm the crop has come up.'
                    : status == 'ISSUED'
                        ? 'Valid: the farmer can collect inputs at any SkyScore agro-dealer.'
                        : 'This voucher is ${status.toLowerCase()}.',
            style: const TextStyle(color: Sk.muted),
          ),
      ]),
    );
  }
}
