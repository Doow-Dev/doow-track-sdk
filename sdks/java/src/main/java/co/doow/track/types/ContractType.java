package co.doow.track.types;

import com.fasterxml.jackson.annotation.JsonValue;

public enum ContractType {
    PAY_AS_YOU_GO("PAY_AS_YOU_GO"),
    ENTERPRISE("ENTERPRISE"),
    UNKNOWN("UNKNOWN");

    private final String value;

    ContractType(String value) {
        this.value = value;
    }

    @JsonValue
    public String getValue() {
        return value;
    }
}
