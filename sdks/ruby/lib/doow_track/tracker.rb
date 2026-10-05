# frozen_string_literal: true

require "net/http"
require "json"
require "zlib"
require "stringio"
require "time"
require "securerandom"
require "uri"

module DoowTrack
  class Tracker
    MAX_RETRY_AFTER_SECONDS = 30
    MAX_BACKOFF_SECONDS = 10
    MAX_RESPONSE_BYTES = 64 * 1024
    SHUTDOWN_JOIN_SECONDS = 30
    MAX_BATCH_EVENTS = 500

    ApiResponse = Struct.new(:code, :body, :retry_after)

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
      @stopping = false
      @stop_mutex = Mutex.new
      @stop_signal = ConditionVariable.new
      @hold_until = 0.0
      @flusher = start_flusher
    end

    def track(event)
      return unless @options[:enabled]

      final_event = event.is_a?(Hash) ? TrackEvent.new(**event) : event
      final_event = TrackEvent.new(
        **final_event.to_h.merge(
          event_id: final_event.event_id || SecureRandom.uuid,
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
        flush_async if @buffer.size >= @options[:flush_at] && monotonic_now >= @hold_until
      end
    end

    def flush
      batch = nil
      @mutex.synchronize do
        return if @buffer.empty?
        batch = @buffer.dup
        @buffer.clear
      end
      return unless batch

      batch.each_slice(MAX_BATCH_EVENTS).with_index do |chunk, index|
        next unless send_batch(chunk) == :failed

        requeue(batch.drop(index * MAX_BATCH_EVENTS))
        @hold_until = monotonic_now + @options[:flush_interval]
        break
      end
    end

    def shutdown
      @stop_mutex.synchronize do
        @stopping = true
        @stop_signal.broadcast
      end
      @flusher&.join(SHUTDOWN_JOIN_SECONDS)
      flush
    end

    private

    def start_flusher
      return nil if @options[:flush_interval] <= 0

      Thread.new do
        loop do
          @stop_mutex.synchronize do
            @stop_signal.wait(@stop_mutex, @options[:flush_interval]) unless @stopping
          end
          break if @stopping

          begin
            flush
          rescue StandardError => e
            report(e)
          end
        end
      end
    end

    def monotonic_now
      Process.clock_gettime(Process::CLOCK_MONOTONIC)
    end

    def requeue(events)
      return if events.empty? || @stopping

      @mutex.synchronize do
        @buffer = events + @buffer
        @buffer = @buffer.first(@options[:max_queue_size]) if @buffer.size > @options[:max_queue_size]
      end
    end

    def flush_async
      Thread.new do
        flush
      rescue StandardError => e
        report(e)
      end
    end

    def send_batch(batch)
      url = URI("#{@options[:endpoint].chomp('/')}/telemetry/events")
      batch_id = SecureRandom.uuid
      begin
        json = build_payload(batch_id, batch).to_json
      rescue StandardError => e
        report(e)
        return :abandoned
      end
      body, encoding = encode_body(json)

      (@options[:retry_count] + 1).times do |attempt|
        last_attempt = attempt >= @options[:retry_count]
        begin
          response = post(url, body, encoding)
        rescue StandardError => e
          if last_attempt
            report(e)
          else
            sleep(backoff_seconds(attempt))
            next
          end
          return :failed
        end

        status = response.code.to_i
        case status
        when 207
          report(PartialAcceptError.from_body(response.body))
          return :delivered
        when 200..299
          log("[doow-track] Flushed #{batch.size} events")
          return :delivered
        when 408, 429, 500..599
          if last_attempt
            report(Error.new("API error: #{DoowTrack.sanitize(response.body)}", status_code: status))
            return :failed
          end
          sleep([backoff_seconds(attempt), [429, 503].include?(status) ? retry_after_seconds(response.retry_after) : 0].max)
        else
          report(Error.new("API error: #{DoowTrack.sanitize(response.body)}", status_code: status))
          return :abandoned
        end
      end
      :failed
    end

    def post(url, body, encoding)
      http = Net::HTTP.new(url.host, url.port)
      http.use_ssl = url.scheme == "https"
      http.open_timeout = @options[:timeout]
      http.read_timeout = @options[:timeout]

      request = Net::HTTP::Post.new(url)
      request["Authorization"] = "Bearer #{@api_key}"
      request["Content-Type"] = "application/json"
      request["Content-Encoding"] = encoding if encoding
      request.body = body
      http.request(request) do |response|
        return ApiResponse.new(response.code, read_capped(response), response["Retry-After"])
      end
    end

    def read_capped(response)
      body = String.new(encoding: Encoding::BINARY)
      response.read_body do |chunk|
        body << chunk.byteslice(0, MAX_RESPONSE_BYTES - body.bytesize)
        break if body.bytesize >= MAX_RESPONSE_BYTES
      end
      body
    end

    def backoff_seconds(attempt)
      [2**attempt, MAX_BACKOFF_SECONDS].min
    end

    def build_payload(batch_id, batch)
      events = batch.map do |event|
        h = event.to_h
        measurement = { metric_name: h[:metric], quantity: h[:quantity], metric_tuple_hint: h[:metric_tuple_hint] }.compact
        {
          event_id: h[:event_id],
          license_id: h[:license_id],
          occurred_at: h[:timestamp],
          source_system: h[:source_system].to_s.strip.empty? ? "sdk" : h[:source_system],
          kind: h[:kind],
          attribution: h[:attribution],
          metadata: h[:metadata],
          measurements: [measurement]
        }.compact
      end
      { batch_id: batch_id, sdk_version: VERSION, events: events }
    end

    def encode_body(json)
      return [json, nil] if @options[:disable_compression] || json.bytesize <= 1024

      io = StringIO.new
      io.set_encoding(Encoding::BINARY)
      gz = Zlib::GzipWriter.new(io)
      gz.write(json)
      gz.close
      [io.string, "gzip"]
    end

    def retry_after_seconds(header)
      return 0 if header.nil? || header.to_s.strip.empty?

      seconds = Float(header.to_s.strip, exception: false)
      seconds ||= begin
        Time.httpdate(header.to_s.strip) - Time.now
      rescue ArgumentError
        0
      end
      seconds.clamp(0, MAX_RETRY_AFTER_SECONDS)
    end

    def report(error)
      begin
        @options[:on_error]&.call(error)
      rescue StandardError => e
        log("[doow-track] on_error handler raised: #{e.message}")
      end
      log("[doow-track] Error: #{error.message}")
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
