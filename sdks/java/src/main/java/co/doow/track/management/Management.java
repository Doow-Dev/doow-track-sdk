package co.doow.track.management;

import co.doow.track.DoowError;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;

import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;

public class Management {
    private final String apiKey;
    private final ManagementOptions options;
    private final ObjectMapper mapper;

    private final AppsResource apps;
    private final ContractsResource contracts;
    private final LicensesResource licenses;
    private final MetricsResource metrics;
    private final ExpensesResource expenses;

    public Management(String apiKey) {
        this(apiKey, new ManagementOptions());
    }

    public Management(String apiKey, ManagementOptions options) {
        String envKey = System.getenv("DOOW_TRACK_API_KEY");
        this.apiKey = envKey != null ? envKey : apiKey;
        this.options = options;

        if (this.apiKey == null || !this.apiKey.startsWith("dk_")) {
            throw new DoowError("Invalid API key format. Must start with 'dk_'.");
        }

        this.mapper = new ObjectMapper();
        this.mapper.registerModule(new JavaTimeModule());
        this.mapper.setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
        this.mapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        this.apps = new AppsResource(this);
        this.contracts = new ContractsResource(this);
        this.licenses = new LicensesResource(this);
        this.metrics = new MetricsResource(this);
        this.expenses = new ExpensesResource(this);
    }

    public AppsResource apps() { return apps; }
    public ContractsResource contracts() { return contracts; }
    public LicensesResource licenses() { return licenses; }
    public MetricsResource metrics() { return metrics; }
    public ExpensesResource expenses() { return expenses; }

    <T> T request(String method, String path, Object body, com.fasterxml.jackson.databind.JavaType responseType) {
        return requestInternal(method, path, body, responseType);
    }

    <T> T request(String method, String path, Object body, Class<T> responseType) {
        return requestInternal(method, path, body, mapper.constructType(responseType));
    }

    @SuppressWarnings("unchecked")
    private <T> T requestInternal(String method, String path, Object body, com.fasterxml.jackson.databind.JavaType responseType) {
        String url = options.getEndpoint().replaceAll("/$", "") + "/sdk" + path;

        if (options.isDebug()) {
            System.err.println("[doow/management] " + method + " " + path);
        }

        for (int attempt = 0; attempt <= options.getRetryCount(); attempt++) {
            try {
                HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setRequestMethod(method);
                conn.setConnectTimeout(options.getTimeoutMs());
                conn.setReadTimeout(options.getTimeoutMs());
                conn.setRequestProperty("Authorization", "Bearer " + apiKey);
                conn.setRequestProperty("Content-Type", "application/json");

                if (body != null && !method.equals("GET") && !method.equals("DELETE")) {
                    conn.setDoOutput(true);
                    String json = mapper.writeValueAsString(body);
                    conn.getOutputStream().write(json.getBytes("UTF-8"));
                }

                int status = conn.getResponseCode();

                if (status >= 200 && status < 300) {
                    if (responseType == null || responseType.getRawClass() == Void.class) {
                        return null;
                    }
                    InputStream is = conn.getInputStream();
                    return mapper.readValue(is, responseType);
                }

                if (status >= 500 && attempt < options.getRetryCount()) {
                    Thread.sleep((long) Math.pow(2, attempt) * 1000);
                    continue;
                }

                String errorBody = readStream(conn.getErrorStream());
                throw new DoowError("API error: " + errorBody, status);

            } catch (IOException e) {
                if (attempt < options.getRetryCount()) {
                    try {
                        Thread.sleep((long) Math.pow(2, attempt) * 1000);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        throw new DoowError("Request interrupted", 0);
                    }
                    continue;
                }
                throw new DoowError("Request failed: " + e.getMessage(), 0);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new DoowError("Request interrupted", 0);
            }
        }

        throw new DoowError("Max retries exceeded");
    }

    void delete(String path) {
        request("DELETE", path, null, Void.class);
    }

    ObjectMapper getMapper() {
        return mapper;
    }

    private String readStream(InputStream is) throws IOException {
        if (is == null) return "";
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(is))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line);
            }
            return sb.toString();
        }
    }
}
