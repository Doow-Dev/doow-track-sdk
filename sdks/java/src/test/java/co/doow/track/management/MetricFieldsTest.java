package co.doow.track.management;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

class MetricFieldsTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    private HttpServer server;
    private final AtomicReference<JsonNode> sentBody = new AtomicReference<>();
    private volatile String responseBody = "{}";

    @BeforeEach
    void startServer() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/sdk/licenses/lic-1/metrics", exchange -> {
            sentBody.set(JSON.readTree(exchange.getRequestBody().readAllBytes()));
            byte[] out = responseBody.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(201, out.length);
            exchange.getResponseBody().write(out);
            exchange.close();
        });
        server.start();
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    private Management management() {
        String endpoint = "http://127.0.0.1:" + server.getAddress().getPort();
        return new Management("dk_test_key", new ManagementOptions().setEndpoint(endpoint));
    }

    @Test
    void createSendsTheUnitLabelAndTheEntitlementFields() {
        Models.CreateMetricInput input = new Models.CreateMetricInput("tokens");
        input.rateKind = "USAGE";
        input.usageCustomUnitLabel = "tokens";
        input.entitlementPeriod = "QUARTERLY";
        input.carryoverPolicy = "ROLLOVER";
        input.usageLimit = 1000.0;
        input.usageIncluded = 200.0;
        input.perUnitCap = 50.0;
        input.usageRateIsEstimated = true;
        input.expectedEmissionIntervalMinutes = 15;

        management().metrics().create("lic-1", input);

        JsonNode body = sentBody.get();
        assertEquals("tokens", body.get("metric_type").asText());
        assertEquals("USAGE", body.get("rate_kind").asText());
        assertEquals("tokens", body.get("usage_custom_unit_label").asText());
        assertEquals("QUARTERLY", body.get("entitlement_period").asText());
        assertEquals("ROLLOVER", body.get("carryover_policy").asText());
        assertEquals(1000.0, body.get("usage_limit").asDouble());
        assertEquals(200.0, body.get("usage_included").asDouble());
        assertEquals(50.0, body.get("per_unit_cap").asDouble());
        assertTrue(body.get("usage_rate_is_estimated").asBoolean());
        assertEquals(15, body.get("expected_emission_interval_minutes").asInt());
    }

    @Test
    void createWithOnlyAMetricTypeSendsNothingElse() {
        management().metrics().create("lic-1", new Models.CreateMetricInput("api_calls"));

        JsonNode body = sentBody.get();
        assertEquals(1, body.size());
        assertEquals("api_calls", body.get("metric_type").asText());
    }

    @Test
    void createKeepsAFalseEstimateFlagInsteadOfDroppingIt() {
        Models.CreateMetricInput input = new Models.CreateMetricInput("api_calls");
        input.usageRateIsEstimated = false;

        management().metrics().create("lic-1", input);

        assertFalse(sentBody.get().get("usage_rate_is_estimated").asBoolean());
    }

    @Test
    void theResponseCarriesTheNewFields() {
        responseBody = "{\"id\":\"m-1\",\"license_id\":\"lic-1\",\"metric_type\":\"tokens\","
            + "\"usage_aggregation_type\":\"SUM\",\"rate_kind\":\"USAGE\",\"usage_custom_unit_label\":\"tokens\","
            + "\"entitlement_period\":\"QUARTERLY\",\"carryover_policy\":\"RESET\",\"usage_limit\":1000,"
            + "\"usage_included\":0,\"per_unit_cap\":50,\"usage_rate_is_estimated\":false,"
            + "\"expected_emission_interval_minutes\":15}";

        Models.Metric metric =
            management().metrics().create("lic-1", new Models.CreateMetricInput("tokens"));

        assertEquals("tokens", metric.usageCustomUnitLabel);
        assertEquals("QUARTERLY", metric.entitlementPeriod);
        assertEquals("RESET", metric.carryoverPolicy);
        assertEquals(1000.0, metric.usageLimit);
        assertEquals(0.0, metric.usageIncluded);
        assertEquals(50.0, metric.perUnitCap);
        assertEquals(Boolean.FALSE, metric.usageRateIsEstimated);
        assertEquals(15, metric.expectedEmissionIntervalMinutes);
    }
}
