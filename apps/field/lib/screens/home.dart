// Home: the agent's day (new application, farmers, alerts) or the dealer's counter.
import 'package:flutter/material.dart';

import '../api.dart';
import '../theme.dart';
import 'apply.dart';
import 'dealer.dart';
import 'farmers.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late Future<Json> _me = Api.getJson('/me');
  Future<Json>? _summary;

  @override
  void initState() {
    super.initState();
    if (!Session.instance.isDealer) _summary = Api.getJson('/portfolio/summary');
  }

  void _refresh() => setState(() {
        _me = Api.getJson('/me');
        if (!Session.instance.isDealer) _summary = Api.getJson('/portfolio/summary');
      });

  @override
  Widget build(BuildContext context) {
    final s = Session.instance;
    return Scaffold(
      appBar: AppBar(
        title: Text(s.isDealer ? 'AGRO-DEALER' : 'FIELD AGENT'),
        actions: [
          IconButton(onPressed: _refresh, icon: const Icon(Icons.refresh), tooltip: 'Refresh'),
          PopupMenuButton<String>(
            onSelected: (v) {
              if (v == 'out') s.signOut();
            },
            itemBuilder: (_) => [
              PopupMenuItem(enabled: false, child: Text('${s.name} · ${s.server}', style: const TextStyle(fontSize: 12))),
              const PopupMenuItem(value: 'out', child: Text('Sign out')),
            ],
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async => _refresh(),
        child: ListView(children: [
          FutureBuilder<Json>(
            future: _me,
            builder: (context, snap) {
              final me = snap.data;
              return SkBlock(
                color: Sk.navy,
                padding: const EdgeInsets.fromLTRB(20, 22, 20, 22),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  SkLabel(me == null ? 'Loading…' : 'Season ${me['season']} · business date ${shortDate(me['businessDate'] as String?)}', color: Sk.lime),
                  const SizedBox(height: 18),
                  Text('Hello, ${s.name.split(' ').first}.', style: Sk.display(36, color: Colors.white)),
                  if (me?['dealer'] != null) ...[
                    const SizedBox(height: 8),
                    Text('${(me!['dealer'] as Json)['name']}', style: TextStyle(color: Colors.white.withValues(alpha: 0.8))),
                  ],
                ]),
              );
            },
          ),
          if (s.isDealer) _dealerHome() else _agentHome(),
        ]),
      ),
    );
  }

  Widget _agentHome() {
    return Column(children: [
      FutureBuilder<Json>(
        future: _summary,
        builder: (context, snap) {
          final d = snap.data;
          return Row(children: [
            Expanded(child: SkStat(value: '${d?['loans']?['active'] ?? '–'}', caption: 'Active loans', color: Sk.lime)),
            Expanded(child: SkStat(value: '${d?['applications']?['byStatus']?['REVIEW'] ?? 0}', caption: 'Waiting for officer', color: Sk.fog)),
            Expanded(child: SkStat(value: '${d?['alertsOpen'] ?? '–'}', caption: 'Open alerts')),
          ]);
        },
      ),
      const Divider(),
      _action(Icons.add_location_alt_outlined, 'New application', 'Register a farmer, map the field, score it from space', () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ApplyScreen()))),
      _action(Icons.people_outline, 'Farmers', 'Profiles, fields, loans and vouchers', () => Navigator.push(context, MaterialPageRoute(builder: (_) => const FarmersScreen()))),
      _action(Icons.notifications_none, 'Alerts', 'What the satellites flagged on your loans', () => Navigator.push(context, MaterialPageRoute(builder: (_) => const AlertsScreen()))),
      _action(Icons.qr_code_scanner, 'Check a voucher', 'Look up any voucher code', () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ScanScreen()))),
    ]);
  }

  Widget _dealerHome() {
    return FutureBuilder<Json>(
      future: _me,
      builder: (context, snap) {
        final dealer = snap.data?['dealer'] as Json?;
        return Column(children: [
          Row(children: [
            Expanded(child: SkStat(value: naira(dealer?['balance'] as num?), caption: 'Shop account', color: Sk.lime)),
            Expanded(child: SkStat(value: '${dealer?['vouchersRedeemed'] ?? '–'}', caption: 'Vouchers redeemed', color: Sk.fog)),
          ]),
          const Divider(),
          Padding(
            padding: const EdgeInsets.all(20),
            child: FilledButton.icon(
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(72)),
              onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ScanScreen())).then((_) => _refresh()),
              icon: const Icon(Icons.qr_code_scanner, size: 28),
              label: const Text('SCAN A VOUCHER'),
            ),
          ),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 20),
            child: Text('Scan the farmer\'s voucher, hand over the inputs, and the shop is paid at once into its Ecobank account.', style: TextStyle(color: Sk.muted)),
          ),
        ]);
      },
    );
  }

  Widget _action(IconData icon, String title, String sub, VoidCallback onTap) => InkWell(
        onTap: onTap,
        child: Container(
          decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: Sk.line))),
          padding: const EdgeInsets.fromLTRB(20, 18, 16, 18),
          child: Row(children: [
            Icon(icon, color: Sk.navy),
            const SizedBox(width: 16),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w500, letterSpacing: -0.3)),
                const SizedBox(height: 2),
                Text(sub, style: const TextStyle(color: Sk.muted, fontSize: 13)),
              ]),
            ),
            const Icon(Icons.arrow_forward, color: Sk.navy),
          ]),
        ),
      );
}

class AlertsScreen extends StatelessWidget {
  const AlertsScreen({super.key});
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('ALERTS')),
      body: FutureBuilder<List<dynamic>>(
        future: Api.getList('/alerts', {'status': 'OPEN'}),
        builder: (context, snap) {
          if (snap.hasError) return Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(errorText(snap.error!))));
          if (!snap.hasData) return const LinearProgressIndicator();
          final items = snap.data!.cast<Json>();
          if (items.isEmpty) return const Center(child: Text('No open alerts. Every crop looks fine from space.'));
          return ListView.separated(
            itemCount: items.length,
            separatorBuilder: (_, _) => const Divider(),
            itemBuilder: (_, i) {
              final a = items[i];
              return ListTile(
                title: Text(a['title'] as String),
                subtitle: Text('${a['farmerName'] ?? ''} · ${a['detail']}'),
                trailing: SkPill(a['type'] as String),
              );
            },
          );
        },
      ),
    );
  }
}
