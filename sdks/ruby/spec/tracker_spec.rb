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

  it "reuses the same batch id across retries" do
    stub_request(:post, url).to_return({ status: 503 }, { status: 202 })
    track_one(tracker)
    tracker.flush

    ids = WebMock::RequestRegistry.instance.requested_signatures.hash.keys.map { |s| JSON.parse(s.body)["batch_id"] }
    expect(ids.uniq.size).to eq(1)
    expect(errors).to be_empty
  end

  it "does not retry a 401 and reports it" do
    stub = stub_request(:post, url).to_return(status: 401, body: "no")
    track_one(tracker)
    tracker.flush

    expect(stub).to have_been_requested.once
    expect(errors.first.status_code).to eq(401)
  end
end
