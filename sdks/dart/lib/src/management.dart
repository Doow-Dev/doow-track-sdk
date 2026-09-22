import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import 'types.dart';
import 'errors.dart';

class ManagementOptions {
  final String endpoint;
  final Duration timeout;
  final int retryCount;

  const ManagementOptions({
    this.endpoint = 'https://api.doow.co',
    this.timeout = const Duration(seconds: 30),
    this.retryCount = 3,
  });
}

class Management {
  final String _apiKey;
  final ManagementOptions _options;
  late final AppsClient apps;
  late final ContractsClient contracts;
  late final LicensesClient licenses;
  late final MetricsClient metrics;
  late final ExpensesClient expenses;

  Management(String apiKey, [ManagementOptions? options])
      : _apiKey = _resolveApiKey(apiKey),
        _options = options ?? const ManagementOptions() {
    if (!_apiKey.startsWith('dk_')) {
      throw ValidationError('API key must start with dk_');
    }
    apps = AppsClient(this);
    contracts = ContractsClient(this);
    licenses = LicensesClient(this);
    metrics = MetricsClient(this);
    expenses = ExpensesClient(this);
  }

  static String _resolveApiKey(String apiKey) {
    return Platform.environment['DOOW_TRACK_API_KEY'] ?? apiKey;
  }

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
  }) async {
    final uri = Uri.parse('${_options.endpoint}$path');
    final headers = {
      'Authorization': 'Bearer $_apiKey',
      'Content-Type': 'application/json',
    };

    for (var attempt = 0; attempt <= _options.retryCount; attempt++) {
      try {
        http.Response response;
        switch (method) {
          case 'GET':
            response = await http.get(uri, headers: headers).timeout(_options.timeout);
            break;
          case 'POST':
            response = await http
                .post(uri, headers: headers, body: body != null ? jsonEncode(body) : null)
                .timeout(_options.timeout);
            break;
          case 'DELETE':
            response = await http.delete(uri, headers: headers).timeout(_options.timeout);
            break;
          default:
            throw DoowError('Unknown method: $method');
        }

        if (response.statusCode >= 200 && response.statusCode < 300) {
          if (response.body.isEmpty) return {};
          return jsonDecode(response.body) as Map<String, dynamic>;
        }

        if (response.statusCode == 401) {
          throw AuthError('Invalid API key');
        }

        if (response.statusCode == 429) {
          final retryAfter = response.headers['retry-after'];
          final delay = retryAfter != null
              ? Duration(seconds: int.tryParse(retryAfter) ?? 1)
              : Duration(milliseconds: 100 * (1 << attempt));
          await Future.delayed(delay);
          continue;
        }

        if (response.statusCode >= 500) {
          await Future.delayed(Duration(milliseconds: 100 * (1 << attempt)));
          continue;
        }

        throw DoowError('HTTP ${response.statusCode}: ${response.body}',
            statusCode: response.statusCode);
      } catch (e) {
        if (e is DoowError) rethrow;
        if (attempt == _options.retryCount) {
          throw DoowError('Request failed: $e');
        }
        await Future.delayed(Duration(milliseconds: 100 * (1 << attempt)));
      }
    }
    throw DoowError('Max retries exceeded');
  }
}

class AppsClient {
  final Management _mgmt;
  AppsClient(this._mgmt);

  Future<List<App>> list() async {
    final data = await _mgmt._request('GET', '/sdk/apps');
    final list = data['apps'] ?? data['data'] ?? [];
    return (list as List).map((e) => App.fromJson(e)).toList();
  }

  Future<App> get(String id) async {
    final data = await _mgmt._request('GET', '/sdk/apps/$id');
    return App.fromJson(data);
  }

  Future<App> create(CreateAppInput input) async {
    final data = await _mgmt._request('POST', '/sdk/apps', body: input.toJson());
    return App.fromJson(data);
  }

  Future<void> delete(String id) async {
    await _mgmt._request('DELETE', '/sdk/apps/$id');
  }
}

class ContractsClient {
  final Management _mgmt;
  ContractsClient(this._mgmt);

  Future<List<Contract>> list(String appId) async {
    final data = await _mgmt._request('GET', '/sdk/apps/$appId/contracts');
    final list = data['contracts'] ?? data['data'] ?? [];
    return (list as List).map((e) => Contract.fromJson(e)).toList();
  }

  Future<Contract> get(String id) async {
    final data = await _mgmt._request('GET', '/sdk/contracts/$id');
    return Contract.fromJson(data);
  }

  Future<Contract> create(String appId, CreateContractInput input) async {
    final data = await _mgmt._request('POST', '/sdk/apps/$appId/contracts',
        body: input.toJson());
    return Contract.fromJson(data);
  }

  Future<void> delete(String id) async {
    await _mgmt._request('DELETE', '/sdk/contracts/$id');
  }
}

class LicensesClient {
  final Management _mgmt;
  LicensesClient(this._mgmt);

  Future<List<License>> list(String contractId) async {
    final data = await _mgmt._request('GET', '/sdk/contracts/$contractId/licenses');
    final list = data['licenses'] ?? data['data'] ?? [];
    return (list as List).map((e) => License.fromJson(e)).toList();
  }

  Future<License> get(String id) async {
    final data = await _mgmt._request('GET', '/sdk/licenses/$id');
    return License.fromJson(data);
  }
}

class MetricsClient {
  final Management _mgmt;
  MetricsClient(this._mgmt);

  Future<List<Metric>> list(String licenseId) async {
    final data = await _mgmt._request('GET', '/sdk/licenses/$licenseId/metrics');
    final list = data['metrics'] ?? data['data'] ?? [];
    return (list as List).map((e) => Metric.fromJson(e)).toList();
  }

  Future<Metric> get(String id) async {
    final data = await _mgmt._request('GET', '/sdk/metrics/$id');
    return Metric.fromJson(data);
  }

  Future<Metric> create(String licenseId, CreateMetricInput input) async {
    final data = await _mgmt._request('POST', '/sdk/licenses/$licenseId/metrics',
        body: input.toJson());
    return Metric.fromJson(data);
  }

  Future<void> delete(String id) async {
    await _mgmt._request('DELETE', '/sdk/metrics/$id');
  }
}

class ExpensesClient {
  final Management _mgmt;
  ExpensesClient(this._mgmt);

  Future<List<Expense>> list() async {
    final data = await _mgmt._request('GET', '/sdk/expenses');
    final list = data['expenses'] ?? data['data'] ?? [];
    return (list as List).map((e) => Expense.fromJson(e)).toList();
  }

  Future<Expense> create(CreateExpenseInput input) async {
    final data = await _mgmt._request('POST', '/sdk/expenses', body: input.toJson());
    return Expense.fromJson(data);
  }
}
