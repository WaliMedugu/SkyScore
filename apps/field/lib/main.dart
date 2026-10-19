// SkyScore field app: agents register farmers, map fields and sign loans; agro-dealers redeem vouchers.
import 'package:flutter/material.dart';

import 'api.dart';
import 'screens/home.dart';
import 'screens/setup.dart';
import 'theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Session.instance.load();
  runApp(const SkyScoreApp());
}

class SkyScoreApp extends StatelessWidget {
  const SkyScoreApp({super.key});

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Session.instance,
      builder: (context, _) => MaterialApp(
        title: 'SkyScore Field',
        debugShowCheckedModeBanner: false,
        theme: Sk.theme(),
        // A new key on sign-in/out resets navigation to the right home screen.
        home: Session.instance.signedIn ? HomeScreen(key: ValueKey(Session.instance.token)) : const SetupScreen(),
      ),
    );
  }
}
