# frozen_string_literal: true

require "json"

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

  class PartialAcceptError < Error
    attr_reader :accepted, :rejected, :batch_id, :rejections

    def initialize(accepted:, rejected:, batch_id:, rejections:)
      @accepted = accepted
      @rejected = rejected
      @batch_id = batch_id
      @rejections = rejections
      first = rejections.first
      detail = first ? " (#{first['event_id']}: #{first['reason']})" : ""
      super("batch #{batch_id} partially accepted: #{rejected} rejected#{detail}", status_code: 207)
    end

    def self.from_body(body)
      data = begin
        JSON.parse(body.to_s)
      rescue JSON::ParserError
        {}
      end
      data = {} unless data.is_a?(Hash)
      rejections = data["rejections"].is_a?(Array) ? data["rejections"] : []
      new(
        accepted: data["accepted"].to_i,
        rejected: data["rejected"].to_i,
        batch_id: data["batch_id"].to_s,
        rejections: rejections
      )
    end
  end
end
