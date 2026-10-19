// First screen: which SkyScore server, and who is signing in.
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../api.dart';
import '../theme.dart';

class SetupScreen extends StatefulWidget {
  const SetupScreen({super.key});
  @override
  State<SetupScreen> createState() => _SetupScreenState();
}

class _SetupScreenState extends State<SetupScreen> {
  final _server = TextEditingController(text: Session.instance.server);
  final _user = TextEditingController();
  final _pin = TextEditingController();
  bool _busy = false;
  String? _error;
  String? _health;

  Future<void> _check() async {
    await Session.instance.setServer(_server.text);
    setState(() => _health = 'Checking…');
    try {
      final h = await Api.getJson('/health');
      setState(() => _health = 'Connected · ${h['snapshots']} real fields on file${h['offline'] == true ? ' · offline mode' : ''}');
    } catch (e) {
      setState(() => _health = errorText(e));
    }
  }

  Future<void> _signIn() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await Session.instance.setServer(_server.text);
      await Session.instance.signIn(_user.text, _pin.text);
    } catch (e) {
      setState(() => _error = errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: ListView(children: [
          Container(
            color: Sk.navy,
            padding: const EdgeInsets.fromLTRB(20, 28, 20, 24),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const SkLabel('Ecobank agri-finance · field app', color: Sk.lime),
              const SizedBox(height: 40),
              Text('SkyScore', style: Sk.display(64, color: Colors.white)),
              const SizedBox(height: 10),
              Text('Credit for young farmers, underwritten from space.', style: TextStyle(color: Colors.white.withValues(alpha: 0.8), fontSize: 16)),
            ]),
          ),
          Padding(
            padding: const EdgeInsets.all(20),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              if (!kIsWeb) ...[
                const SkLabel('SkyScore server', square: true),
                const SizedBox(height: 8),
                TextField(
                  controller: _server,
                  keyboardType: TextInputType.url,
                  decoration: InputDecoration(
                    hintText: 'http://192.168.1.10:8080',
                    suffixIcon: IconButton(icon: const Icon(Icons.wifi_tethering), tooltip: 'Test connection', onPressed: _check),
                  ),
                ),
                if (_health != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(_health!, style: const TextStyle(fontSize: 12, color: Sk.muted))),
                const SizedBox(height: 24),
              ],
              const SkLabel('Sign in', square: true),
              const SizedBox(height: 8),
              TextField(controller: _user, decoration: const InputDecoration(labelText: 'USERNAME'), autocorrect: false, textInputAction: TextInputAction.next),
              const SizedBox(height: 12),
              TextField(
                controller: _pin,
                decoration: const InputDecoration(labelText: 'PIN'),
                obscureText: true,
                keyboardType: TextInputType.number,
                onSubmitted: (_) => _signIn(),
              ),
              if (_error != null) Padding(padding: const EdgeInsets.only(top: 10), child: Text(_error!, style: const TextStyle(color: Sk.stress))),
              const SizedBox(height: 20),
              FilledButton(
                style: FilledButton.styleFrom(backgroundColor: Sk.lime, foregroundColor: Sk.navy),
                onPressed: _busy ? null : _signIn,
                child: Text(_busy ? 'SIGNING IN…' : 'SIGN IN →'),
              ),
              const SizedBox(height: 16),
              const Text('Field agents register farmers and map fields. Agro-dealers scan vouchers. Sandbox accounts are listed in apps/api/src/seed/users.ts.',
                  style: TextStyle(fontSize: 12, color: Sk.faint)),
            ]),
          ),
        ]),
      ),
    );
  }
}
