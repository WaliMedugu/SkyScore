// SkyScore API client: server address, sign-in session, JSON requests with readable errors.
import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

typedef Json = Map<String, dynamic>;

class ApiException implements Exception {
  ApiException(this.status, this.message, [this.details = const []]);
  final int status;
  final String message;
  final List<String> details;
  @override
  String toString() => details.isEmpty ? message : '$message ${details.join(' ')}';
}

/// The signed-in session and server address, persisted on the phone.
class Session extends ChangeNotifier {
  Session._();
  static final Session instance = Session._();

  String server = kIsWeb ? Uri.base.origin : 'http://192.168.1.10:8080';
  String? token;
  Json? user;
  SharedPreferences? _prefs;

  bool get signedIn => token != null && user != null;
  String get role => (user?['role'] as String?) ?? '';
  bool get isDealer => role == 'dealer';
  String get name => (user?['name'] as String?) ?? '';

  Future<void> load() async {
    try {
      _prefs = await SharedPreferences.getInstance();
      server = _prefs!.getString('server') ?? server;
      token = _prefs!.getString('token');
      final u = _prefs!.getString('user');
      user = u == null ? null : jsonDecode(u) as Json;
    } catch (_) {
      // First run or storage unavailable: start signed out.
    }
  }

  Future<void> setServer(String url) async {
    server = url.trim().replaceAll(RegExp(r'/+$'), '');
    await _prefs?.setString('server', server);
    notifyListeners();
  }

  Future<void> signIn(String username, String pin) async {
    final r = await Api.post('/auth/login', {'username': username.trim().toLowerCase(), 'pin': pin});
    token = r['token'] as String;
    user = r['user'] as Json;
    await _prefs?.setString('token', token!);
    await _prefs?.setString('user', jsonEncode(user));
    notifyListeners();
  }

  Future<void> signOut() async {
    token = null;
    user = null;
    await _prefs?.remove('token');
    await _prefs?.remove('user');
    notifyListeners();
  }
}

class Api {
  static Uri uri(String path, [Map<String, String>? query]) => Uri.parse('${Session.instance.server}/api/v1$path').replace(queryParameters: query);

  static Map<String, String> get _headers => {
        'content-type': 'application/json',
        if (Session.instance.token != null) 'authorization': 'Bearer ${Session.instance.token}',
      };

  static Future<dynamic> _send(Future<http.Response> Function() call) async {
    http.Response res;
    try {
      res = await call().timeout(const Duration(seconds: 30));
    } on TimeoutException {
      throw ApiException(0, 'The server took too long to answer.');
    } catch (_) {
      throw ApiException(0, "Can't reach the SkyScore server at ${Session.instance.server}. Check Wi-Fi and the address in Settings.");
    }
    final body = res.body.isEmpty ? null : _tryJson(res.body);
    if (res.statusCode >= 400) {
      final err = body is Map ? body['error'] as Map? : null;
      final details = (err?['details'] as List?)?.map((d) => (d as Map)['message'].toString()).toList() ?? const <String>[];
      if (res.statusCode == 401 && Session.instance.signedIn) unawaited(Session.instance.signOut());
      throw ApiException(res.statusCode, err?['message']?.toString() ?? 'Request failed (${res.statusCode}).', details);
    }
    return body;
  }

  static dynamic _tryJson(String s) {
    try {
      return jsonDecode(s);
    } catch (_) {
      return s;
    }
  }

  static Future<dynamic> get(String path, [Map<String, String>? query]) => _send(() => http.get(uri(path, query), headers: _headers));
  static Future<Json> getJson(String path, [Map<String, String>? query]) async => (await get(path, query)) as Json;
  static Future<List<dynamic>> getList(String path, [Map<String, String>? query]) async => (await get(path, query)) as List<dynamic>;
  static Future<Json> post(String path, [Object? body]) async =>
      (await _send(() => http.post(uri(path), headers: _headers, body: jsonEncode(body ?? <String, dynamic>{})))) as Json;

  /// URL of a satellite frame image (served from saved snapshots when available).
  static String frameUrl(Json frame, {String kind = 'rgb', String? snap, int size = 256}) {
    final bbox = (frame['bbox'] as List).join(',');
    return uri('/scenes/${Uri.encodeComponent(frame['sceneId'] as String)}/image', {
      'bbox': bbox,
      'kind': kind,
      'size': '$size',
      'snap': ?snap,
    }).toString();
  }
}

String errorText(Object e) => e is ApiException ? e.toString() : 'Something went wrong: $e';
