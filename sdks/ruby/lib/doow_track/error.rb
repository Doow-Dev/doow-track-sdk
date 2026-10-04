# frozen_string_literal: true

require "json"

module DoowTrack
  MAX_ERROR_TEXT = 512

  def self.sanitize(value)
    text = value.to_s.gsub(/[[:cntrl:]]/, " ")
    text.length > MAX_ERROR_TEXT ? "#{text[0, MAX_ERROR_TEXT]}..." : text
  end

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
      rejections = (data["rejections"].is_a?(Array) ? data["rejections"] : [])
        .select { |r| r.is_a?(Hash) }
        .map { |r| { "event_id" => DoowTrack.sanitize(r["event_id"] || "unknown"), "reason" => DoowTrack.sanitize(r["reason"]) } }
      new(
        accepted: to_count(data["accepted"]),
        rejected: to_count(data["rejected"]),
        batch_id: DoowTrack.sanitize(data["batch_id"]),
        rejections: rejections
      )
    end

    def self.to_count(value)
      Integer(value)
    rescue ArgumentError, TypeError
      0
    end
  end
end
