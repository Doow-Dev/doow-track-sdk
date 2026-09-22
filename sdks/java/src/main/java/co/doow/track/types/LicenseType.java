package co.doow.track.types;

import com.fasterxml.jackson.annotation.JsonValue;

/**
 * License types for SDK creation. SDK only supports USAGE_BASED.
 */
public enum LicenseType {
    USAGE_BASED("USAGE_BASED");

    private final String value;

    LicenseType(String value) {
        this.value = value;
    }

    @JsonValue
    public String getValue() {
        return value;
    }
}
