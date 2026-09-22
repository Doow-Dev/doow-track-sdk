# frozen_string_literal: true

module DoowTrack
  class Error < StandardError
    attr_reader :status_code, :error_class

    def initialize(message, status_code: 0, error_class: nil)
      super(message)
      @status_code = status_code
      @error_class = error_class
    end

    def not_found?
      status_code == 404
    end

    def unauthorized?
      status_code == 401
    end

    def forbidden?
      status_code == 403
    end

    def rate_limited?
      status_code == 429
    end

    def server_error?
      status_code >= 500
    end
  end
end
