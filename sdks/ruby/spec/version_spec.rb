# frozen_string_literal: true

require "spec_helper"

RSpec.describe "DoowTrack::VERSION" do
  it "matches the version in the gemspec" do
    gemspec = Gem::Specification.load(File.expand_path("../doow_track.gemspec", __dir__))

    expect(DoowTrack::VERSION).to eq(gemspec.version.to_s)
  end
end
