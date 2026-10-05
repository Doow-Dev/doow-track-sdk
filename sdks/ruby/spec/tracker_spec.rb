# frozen_string_literal: true

require "spec_helper"
require "zlib"
require "stringio"

RSpec.describe DoowTrack::Tracker do
  let(:endpoint) { "https://test.doow.co" }
  let(:url) { "#{endpoint}/telemetry/events" }
  let(:errors) { [] }
  let(:tracker) do
    described_class.new(
      "dk_test",
      endpoint: endpoint,
      flush_interval: 0,
      flush_at: 1000,
      retry_count: 2,
      on_error: ->(e) { errors << e }
    )
  end

  let(:hint) { DoowTrack::MetricTupleHint.new(app_name: "app", license_name: "lic", metric_name: "calls") }

  def track_one(tracker, **extra)
    tracker.track(DoowTrack::TrackEvent.new(metric: "api_calls", quantity: 1, license_id: "lic_1", **extra))
  end

  def body_of(request)
    raw = request.body
    raw = Zlib::GzipReader.new(StringIO.new(raw)).read if request.headers["Content-Encoding"] == "gzip"
    JSON.parse(raw)
  end

  before { allow_any_instance_of(Object).to receive(:sleep) }

  it "sends the batch envelope with an object tuple hint on 202" do
    stub = stub_request(:post, url).to_return(status: 202, body: { accepted: 1, rejected: 0 }.to_json)
    track_one(tracker, metric_tuple_hint: hint)
    tracker.flush

    expect(stub).to have_been_requested.once
    expect(a_request(:post, url).with { |r|
      body = body_of(r)
      event = body["events"].first
      body["batch_id"] && body["sdk_version"] &&
        event["event_id"] && event["occurred_at"] && event["license_id"] == "lic_1" &&
        event["source_system"] == "sdk" &&
        event["measurements"].first["metric_tuple_hint"] == { "app_name" => "app", "license_name" => "lic", "metric_name" => "calls" }
    }).to have_been_made
    expect(errors).to be_empty
  end

  it "declares gzip only when the body is a real gzip stream" do
    stub_request(:post, url).to_return(status: 202)
    300.times { track_one(tracker) }
    tracker.flush

    expect(a_request(:post, url).with { |r|
      r.headers["Content-Encoding"] == "gzip" && body_of(r)["events"].size == 300
    }).to have_been_made
  end

  it "splits a flush of more than 500 events into chunks of at most 500 with distinct batch ids" do
    backlog = described_class.new(
      "dk_test",
      endpoint: endpoint,
      flush_interval: 0,
      flush_at: 5000,
      retry_count: 0,
      on_error: ->(e) { errors << e }
    )
    bodies = []
    stub_request(:post, url).to_return do |request|
      bodies << body_of(request)
      { status: 202 }
    end
    1200.times { track_one(backlog) }
    backlog.flush

    expect(bodies.map { |b| b["events"].size }).to eq([500, 500, 200])
    expect(bodies.map { |b| b["batch_id"] }.uniq.size).to eq(3)
    expect(bodies.flat_map { |b| b["events"].map { |e| e["event_id"] } }.uniq.size).to eq(1200)
    expect(errors).to be_empty
  end

  it "keeps sending later chunks after a chunk fails permanently" do
    backlog = described_class.new(
      "dk_test",
      endpoint: endpoint,
      flush_interval: 0,
      flush_at: 5000,
      retry_count: 0,
      on_error: ->(e) { errors << e }
    )
    stub_request(:post, url).to_return({ status: 400, body: "bad" }, { status: 202 })
    700.times { track_one(backlog) }
    backlog.flush

    expect(a_request(:post, url)).to have_been_made.twice
    expect(errors.size).to eq(1)
  end

  it "requeues the failed chunk and every later chunk after a transient failure and sends nothing more" do
    backlog = described_class.new(
      "dk_test",
      endpoint: endpoint,
      flush_interval: 0,
      flush_at: 5000,
      retry_count: 0,
      on_error: ->(e) { errors << e }
    )
    bodies = []
    stub_request(:post, url).to_return do |request|
      bodies << body_of(request)
      { status: bodies.size == 1 ? 202 : 503 }
    end
    1200.times { track_one(backlog) }
    backlog.flush

    expect(bodies.size).to eq(2)
    expect(errors.size).to eq(1)
    failed_chunk = bodies[1]["events"].map { |e| e["event_id"] }
    buffered = backlog.instance_variable_get(:@buffer)
    expect(buffered.size).to eq(700)
    expect(buffered.first(500).map(&:event_id)).to eq(failed_chunk)
  end

  it "retries a 408 request timeout with the same batch id" do
    bodies = []
    stub_request(:post, url).to_return do |request|
      bodies << body_of(request)
      { status: bodies.size == 1 ? 408 : 202 }
    end
    track_one(tracker)
    tracker.flush

    expect(bodies.size).to eq(2)
    expect(bodies[1]["batch_id"]).to eq(bodies[0]["batch_id"])
    expect(errors).to be_empty
  end

  it "reports a chunk that cannot be serialized and still sends the rest" do
    backlog = described_class.new(
      "dk_test",
      endpoint: endpoint,
      flush_interval: 0,
      flush_at: 5000,
      retry_count: 0,
      on_error: ->(e) { errors << e }
    )
    stub_request(:post, url).to_return(status: 202)
    track_one(backlog, metadata: { bad: Float::NAN })
    600.times { track_one(backlog) }
    backlog.flush

    expect(errors.size).to eq(1)
    expect(a_request(:post, url)).to have_been_made.once
  end

  it "holds count-triggered flushes after a transient failure" do
    backlog = described_class.new(
      "dk_test",
      endpoint: endpoint,
      flush_interval: 0,
      flush_at: 2,
      retry_count: 0,
      on_error: ->(e) { errors << e }
    )
    backlog.instance_variable_set(:@hold_until, Process.clock_gettime(Process::CLOCK_MONOTONIC) + 100)
    2.times { track_one(backlog) }
    sleep(0.05)

    expect(a_request(:post, url)).not_to have_been_made
    expect(backlog.instance_variable_get(:@buffer).size).to eq(2)
  end

  it "reports each rejection on 207 and does not retry" do
    stub = stub_request(:post, url).to_return(
      status: 207,
      body: {
        accepted: 1, rejected: 1, batch_id: "b",
        rejections: [{ event_id: "evt-x", reason: "license_id is required" }]
      }.to_json
    )
    track_one(tracker)
    tracker.flush

    expect(stub).to have_been_requested.once
    expect(errors.size).to eq(1)
    expect(errors.first).to be_a(DoowTrack::PartialAcceptError)
    expect(errors.first.rejections.first["event_id"]).to eq("evt-x")
  end

  it "reuses the same batch id and event id across retries" do
    sent = []
    WebMock.after_request { |request, _response| sent << JSON.parse(request.body) }
    stub_request(:post, url).to_return({ status: 503 }, { status: 202 })
    track_one(tracker)
    tracker.flush

    expect(sent.size).to eq(2)
    expect(sent.map { |b| b["batch_id"] }.uniq.size).to eq(1)
    expect(sent.map { |b| b["events"].first["event_id"] }.uniq.size).to eq(1)
    expect(errors).to be_empty
  end

  it "defaults a blank source_system to sdk" do
    stub_request(:post, url).to_return(status: 202)
    track_one(tracker, source_system: " ")
    tracker.flush

    expect(a_request(:post, url).with { |r| body_of(r)["events"].first["source_system"] == "sdk" }).to have_been_made
  end

  it "does not retry a 401 and reports it" do
    stub = stub_request(:post, url).to_return(status: 401, body: "no")
    track_one(tracker)
    tracker.flush

    expect(stub).to have_been_requested.once
    expect(errors.first.status_code).to eq(401)
  end

  it "does not resend a recorded 207 batch when on_error raises" do
    stub = stub_request(:post, url).to_return(status: 207, body: { accepted: 0, rejected: 1, rejections: [{ event_id: "e", reason: "bad" }] }.to_json)
    raising = described_class.new("dk_test", endpoint: endpoint, flush_interval: 0, flush_at: 1000, retry_count: 2, on_error: ->(_e) { raise "handler failure" })
    track_one(raising)
    raising.flush

    expect(stub).to have_been_requested.once
  end

  it "reports a malformed 207 body without resending" do
    stub = stub_request(:post, url).to_return(status: 207, body: { accepted: "abc", rejected: nil, rejections: [1, "x", { event_id: 5 }] }.to_json)
    track_one(tracker)
    tracker.flush

    expect(stub).to have_been_requested.once
    expect(errors.first).to be_a(DoowTrack::PartialAcceptError)
  end

  def request_count
    WebMock::RequestRegistry.instance.times_executed(WebMock::RequestPattern.new(:post, url))
  end

  def wait_for(timeout = 5)
    deadline = Time.now + timeout
    Kernel.instance_method(:sleep).bind(self).call(0.02) until yield || Time.now > deadline
  end

  it "keeps the periodic flusher alive when on_error raises" do
    allow_any_instance_of(Object).to receive(:sleep).and_call_original
    stub_request(:post, url).to_return({ status: 400, body: "bad" }, { status: 202 })
    flusher = described_class.new("dk_test", endpoint: endpoint, flush_interval: 0.05, flush_at: 1000, retry_count: 0, on_error: ->(_e) { raise "handler failure" })
    track_one(flusher)
    wait_for { request_count >= 1 }
    track_one(flusher)
    wait_for { request_count >= 2 }
    flusher.shutdown

    expect(request_count).to be >= 2
  end

  it "shutdown stops the flusher thread and still flushes the buffer" do
    allow_any_instance_of(Object).to receive(:sleep).and_call_original
    stub_request(:post, url).to_return(status: 202)
    flusher = described_class.new("dk_test", endpoint: endpoint, flush_interval: 30, flush_at: 1000, retry_count: 0)
    track_one(flusher)
    thread = flusher.instance_variable_get(:@flusher)
    wait_for { thread.status == "sleep" }
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    flusher.shutdown
    elapsed = Process.clock_gettime(Process::CLOCK_MONOTONIC) - started

    expect(request_count).to eq(1)
    expect(flusher.instance_variable_get(:@flusher)).not_to be_alive
    expect(elapsed).to be < 2
  end

  it "waits at least the Retry-After on a 429 and retries the same batch" do
    sleeps = []
    allow_any_instance_of(Object).to receive(:sleep) { |_obj, seconds| sleeps << seconds }
    sent = []
    WebMock.after_request { |request, _response| sent << JSON.parse(request.body) }
    stub_request(:post, url).to_return({ status: 429, headers: { "Retry-After" => "7" } }, { status: 202 })
    track_one(tracker)
    tracker.flush

    expect(sent.size).to eq(2)
    expect(sleeps.max).to be >= 7
    expect(sent.map { |b| b["batch_id"] }.uniq.size).to eq(1)
    expect(errors).to be_empty
  end

  it "waits at least the Retry-After on a 503 and retries the same batch" do
    sleeps = []
    allow_any_instance_of(Object).to receive(:sleep) { |_obj, seconds| sleeps << seconds }
    sent = []
    WebMock.after_request { |request, _response| sent << JSON.parse(request.body) }
    stub_request(:post, url).to_return({ status: 503, headers: { "Retry-After" => "7" } }, { status: 202 })
    track_one(tracker)
    tracker.flush

    expect(sent.size).to eq(2)
    expect(sleeps.max).to be >= 7
    expect(sent.map { |b| b["batch_id"] }.uniq.size).to eq(1)
    expect(errors).to be_empty
  end

  it "clamps Retry-After and tolerates garbage" do
    expect(tracker.send(:retry_after_seconds, "2")).to eq(2)
    expect(tracker.send(:retry_after_seconds, "86400")).to eq(30)
    expect(tracker.send(:retry_after_seconds, "garbage")).to eq(0)
    expect(tracker.send(:retry_after_seconds, nil)).to eq(0)
  end

  it "strips C1 control characters from a binary Net::HTTP body" do
    binary = "bad\xC2\x9B31m ok".b
    expect(binary.encoding).to eq(Encoding::BINARY)

    cleaned = DoowTrack.sanitize(binary)

    expect(cleaned).not_to include("\u009b")
    expect(cleaned).to include("ok")
  end

  it "survives invalid bytes in server text" do
    expect(DoowTrack.sanitize("bad\xFFbytes".b)).to include("bytes")
  end

  it "sanitizes and truncates server text" do
    cleaned = DoowTrack.sanitize("line1\nline2\e[31m" + ("x" * 2000))
    expect(cleaned).not_to match(/[\n\e]/)
    expect(cleaned.length).to be <= 520
  end
end
