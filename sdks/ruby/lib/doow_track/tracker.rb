# frozen_string_literal: true

require "net/http"
require "json"
require "zlib"
require "uri"

module DoowTrack
  class Tracker
    DEFAULT_OPTIONS = {
      endpoint: "https://api.doow.co",
      enabled: true,
      debug: false,
      flush_at: 20,
      flush_interval: 10,
      max_queue_size: 10_000,
      timeout: 10,
      retry_count: 3,
      disable_compression: false,
      attribution: nil,
      on_error: nil
    }.freeze

    def initialize(api_key, **options)
      @api_key = ENV["DOOW_TRACK_API_KEY"] || api_key
      @options = DEFAULT_OPTIONS.merge(options)
      @options[:endpoint] = ENV["DOOW_TRACK_ENDPOINT"] if ENV["DOOW_TRACK_ENDPOINT"]
      @options[:enabled] = false if ENV["DOOW_TRACK_DISABLED"] == "true"
      @options[:debug] = true if ENV["DOOW_TRACK_DEBUG"] == "true"

      raise Error, "Invalid API key format. Must start with 'dk_'." unless @api_key&.start_with?("dk_")

      @buffer = []
      @mutex = Mutex.new
      @flusher = start_flusher
    end

    def track(event)
      return unless @options[:enabled]

      final_event = event.is_a?(Hash) ? TrackEvent.new(**event) : event
      final_event = TrackEvent.new(
        **final_event.to_h.merge(
          timestamp: final_event.timestamp || Time.now.utc,
          attribution: merge_attribution(final_event.attribution)
        )
      )

      @mutex.synchronize do
        if @buffer.size >= @options[:max_queue_size]
          log("[doow-track] Queue full, dropping event")
          return
        end
        @buffer << final_event
        flush_async if @buffer.size >= @options[:flush_at]
      end
    end

    def flush
      batch = nil
      @mutex.synchronize do
        return if @buffer.empty?
        batch = @buffer.dup
        @buffer.clear
      end
      send_batch(batch) if batch
    end

    def shutdown
      @flusher&.kill
      flush
    end

    private

    def start_flusher
      return nil if @options[:flush_interval] <= 0

      Thread.new do
        loop do
          sleep @options[:flush_interval]
          flush
        end
      end
    end

    def flush_async
      Thread.new { flush }
    end

    def send_batch(batch)
      url = URI("#{@options[:endpoint].chomp('/')}/telemetry/events")
      payload = { events: batch.map(&:to_h) }
      json = payload.to_json

      (@options[:retry_count] + 1).times do |attempt|
        begin
          http = Net::HTTP.new(url.host, url.port)
          http.use_ssl = url.scheme == "https"
          http.open_timeout = @options[:timeout]
          http.read_timeout = @options[:timeout]

          request = Net::HTTP::Post.new(url)
          request["Authorization"] = "Bearer #{@api_key}"
          request["Content-Type"] = "application/json"

          body = json
          if !@options[:disable_compression] && json.bytesize > 1024
            body = Zlib::Deflate.deflate(json, Zlib::DEFAULT_COMPRESSION)
            request["Content-Encoding"] = "gzip"
          end
          request.body = body

          response = http.request(request)

          if response.code.to_i >= 200 && response.code.to_i < 300
            log("[doow-track] Flushed #{batch.size} events")
            return
          end

          if response.code.to_i >= 500 && attempt < @options[:retry_count]
            sleep(2**attempt)
            next
          end

          raise Error.new("API error: #{response.body}", status_code: response.code.to_i)
        rescue StandardError => e
          if attempt < @options[:retry_count]
            sleep(2**attempt)
            next
          end
          @options[:on_error]&.call(e)
          log("[doow-track] Error: #{e.message}")
        end
      end
    end

    def merge_attribution(event_attribution)
      return event_attribution if @options[:attribution].nil?
      return @options[:attribution] if event_attribution.nil?
      @options[:attribution].merge(event_attribution)
    end

    def log(message)
      $stderr.puts(message) if @options[:debug]
    end
  end
end
