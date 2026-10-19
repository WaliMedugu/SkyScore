// Farmers on the book, and one farmer's fields, applications and loans.
import 'package:flutter/material.dart';

import '../api.dart';
import '../theme.dart';
import 'application.dart';
import 'apply.dart';

class FarmersScreen extends StatefulWidget {
  const FarmersScreen({super.key});
  @override
  State<FarmersScreen> createState() => _FarmersScreenState();
}

class _FarmersScreenState extends State<FarmersScreen> {
  late Future<Json> _list = Api.getJson('/farmers', {'limit': '200'});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('FARMERS')),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.all(16),
          child: TextField(
            decoration: const InputDecoration(labelText: 'SEARCH NAME, PHONE OR HUB', prefixIcon: Icon(Icons.search)),
            onSubmitted: (q) => setState(() => _list = Api.getJson('/farmers', {'q': q, 'limit': '200'})),
          ),
        ),
        const Divider(),
        Expanded(
          child: FutureBuilder<Json>(
            future: _list,
            builder: (context, snap) {
              if (snap.hasError) return Center(child: Text(errorText(snap.error!)));
              if (!snap.hasData) return const LinearProgressIndicator();
              final items = (snap.data!['items'] as List).cast<Json>();
              return ListView.separated(
                itemCount: items.length,
                separatorBuilder: (_, _) => const Divider(),
                itemBuilder: (_, i) {
                  final f = items[i];
                  final loan = f['latestLoan'] as Json?;
                  return ListTile(
                    title: Text(f['name'] as String, style: const TextStyle(fontWeight: FontWeight.w500)),
                    subtitle: Text('${f['phone']} · ${f['farms']} field(s) · ${f['hub'] ?? 'no hub'}'),
                    trailing: loan == null ? null : SkPill(loan['state'] == 'REPAID' ? 'REPAID' : loan['health'] as String),
                    onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => FarmerScreen(id: f['id'] as String))),
                  );
                },
              );
            },
          ),
        ),
      ]),
    );
  }
}

class FarmerScreen extends StatefulWidget {
  const FarmerScreen({super.key, required this.id});
  final String id;
  @override
  State<FarmerScreen> createState() => _FarmerScreenState();
}

class _FarmerScreenState extends State<FarmerScreen> {
  late final Future<Json> _f = Api.getJson('/farmers/${widget.id}');

  Future<void> _setPin() async {
    final c = TextEditingController();
    final pin = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const SkLabel('USSD PIN', square: true),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          const Text('The farmer types a 4-digit PIN. It protects repayments by USSD.'),
          TextField(controller: c, autofocus: true, obscureText: true, maxLength: 4, keyboardType: TextInputType.number),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('CANCEL')),
          FilledButton(onPressed: () => Navigator.pop(ctx, c.text), child: const Text('SAVE')),
        ],
      ),
    );
    if (pin == null || pin.length != 4) return;
    try {
      await Api.post('/farmers/${widget.id}/ussd-pin', {'pin': pin});
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('USSD PIN saved.')));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(e))));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('FARMER'), actions: [IconButton(onPressed: _setPin, icon: const Icon(Icons.pin_outlined), tooltip: 'Set USSD PIN')]),
      body: FutureBuilder<Json>(
        future: _f,
        builder: (context, snap) {
          if (snap.hasError) return Center(child: Text(errorText(snap.error!)));
          if (!snap.hasData) return const LinearProgressIndicator();
          final f = snap.data!;
          return ListView(children: [
            SkBlock(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                SkLabel('${f['hub'] ?? 'No hub'}', square: true),
                const SizedBox(height: 8),
                Text(f['name'] as String, style: Sk.display(32)),
                const SizedBox(height: 6),
                Text('${f['phone']} · ${f['gender'] ?? ''} ${f['age'] != null ? '· ${f['age']} years' : ''}', style: const TextStyle(color: Sk.muted)),
                const SizedBox(height: 10),
                Wrap(spacing: 8, runSpacing: 8, children: [
                  SkPill(f['bvnVerified'] == true ? 'VERIFIED' : 'PENDING', text: f['bvnVerified'] == true ? 'BVN ${f['bvnMasked']}' : 'BVN not verified'),
                  if ((f['priorOnTimeLoans'] as num) > 0) SkPill('REPAID', text: '${f['priorOnTimeLoans']} loan repaid'),
                ]),
              ]),
            ),
            const Padding(padding: EdgeInsets.fromLTRB(20, 20, 20, 8), child: SkLabel('Fields', square: true)),
            for (final farm in (f['farms'] as List).cast<Json>())
              ListTile(
                title: Text(farm['name'] as String),
                subtitle: Text('${farm['cropLabel']} · ${(farm['areaHa'] as num).toStringAsFixed(2)} ha · ${farm['place'] ?? ''}'),
                trailing: farm['application'] == null ? null : SkPill((farm['application'] as Json)['status'] as String),
                onTap: farm['application'] == null
                    ? null
                    : () => Navigator.push(context, MaterialPageRoute(builder: (_) => ApplicationScreen(id: (farm['application'] as Json)['id'] as String))),
              ),
            const Divider(),
            const Padding(padding: EdgeInsets.fromLTRB(20, 20, 20, 8), child: SkLabel('Loans', square: true)),
            for (final l in (f['loans'] as List).cast<Json>())
              ListTile(
                title: Text('${l['seasonYear']} · ${l['cropLabel']} · ${naira(l['principal'] as num)}'),
                subtitle: Text(((l['monitor'] as Json?)?['summary'] as String?) ?? ''),
                trailing: SkPill(l['state'] as String),
                onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => LoanScreen(id: l['id'] as String))),
              ),
            Padding(
              padding: const EdgeInsets.all(20),
              child: FilledButton(
                onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ApplyScreen(farmer: f))),
                child: const Text('MAP A FIELD AND APPLY →'),
              ),
            ),
          ]);
        },
      ),
    );
  }
}
