# frozen_string_literal: true

require "webmock/rspec"
require "doow_track"

RSpec.configure do |config|
  config.after { WebMock.reset_callbacks }
end
