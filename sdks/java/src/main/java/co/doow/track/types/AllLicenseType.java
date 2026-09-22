package co.doow.track.types;

import com.fasterxml.jackson.annotation.JsonValue;

/**
 * All license types (for responses that may include UI-created licenses).
 */
public enum AllLicenseType {
    USAGE_BASED("USAGE_BASED"),
    SEAT_BASED("SEAT_BASED"),
    PREPAID_CREDITS("PREPAID_CREDITS"),
    FLAT_RATE("FLAT_RATE");

    private final String value;

    AllLicenseType(String value) {
        this.value = value;
    }

    @JsonValue
    public String getValue() {
        return value;
    }
}
