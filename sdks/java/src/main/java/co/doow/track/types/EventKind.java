package co.doow.track.types;

import com.fasterxml.jackson.annotation.JsonValue;

public enum EventKind {
    USAGE("USAGE"),
    ADJUSTMENT("ADJUSTMENT");

    private final String value;

    EventKind(String value) {
        this.value = value;
    }

    @JsonValue
    public String getValue() {
        return value;
    }
}
