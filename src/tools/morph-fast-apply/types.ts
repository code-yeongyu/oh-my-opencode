export interface MorphApplyResult {
  success: boolean
  content?: string
  error?: string
}

export interface MorphApiResponse {
  choices: Array<{
    message: {
      content: string
    }
  }>
}
