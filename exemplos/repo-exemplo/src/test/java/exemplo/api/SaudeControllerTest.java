package exemplo.api;

import static org.junit.Assert.assertEquals;
import org.junit.Test;

public class SaudeControllerTest {
    @Test
    public void respondeOk() {
        assertEquals("ok", new SaudeController().saude());
    }
}
