package co.doow.track.types;

import com.fasterxml.jackson.annotation.JsonValue;

public enum CarryoverPolicy {
    EXPIRE_AT_PERIOD_END("EXPIRE_AT_PERIOD_END"),
    ROLLOVER("ROLLOVER"),
    ROLLOVER_CAPPED("ROLLOVER_CAPPED");

    private final String value;

    CarryoverPolicy(String value) {
        this.value = value;
    }

    @JsonValue
    public String getValue() {
        return value;
    }
}
