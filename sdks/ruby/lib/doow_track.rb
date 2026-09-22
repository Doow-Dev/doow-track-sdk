# frozen_string_literal: true

require_relative "doow_track/version"
require_relative "doow_track/error"
require_relative "doow_track/types"
require_relative "doow_track/tracker"
require_relative "doow_track/management"

module DoowTrack
  class << self
    attr_accessor :api_key, :endpoint, :debug

    def configure
      yield self
    end
  end

  self.endpoint = "https://api.doow.co"
  self.debug = false
end
