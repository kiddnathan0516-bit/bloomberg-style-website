/** An error whose message is safe to show to the person using the site. Any other error
 *  is logged on the server and the browser only sees a generic message. */
export class PublicError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}
